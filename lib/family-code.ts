import "server-only";
import crypto from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getKstDayStart } from "@/lib/kst";

/**
 * 가족코드 사전 검증.
 *
 * 왜 필요한가: 가족간병인 추가 화면은 가족코드를 그대로 들고 OTP를 발송하고,
 * 코드가 틀렸다는 사실은 마지막 join_case_v3에서야 드러났다. 사용자는 본인
 * 인증과 동의 6개를 모두 마친 뒤에 거부당했고, 그 사이 SMS가 실제로 나갔다.
 * OTP를 보내기 전에 코드부터 확인한다.
 *
 * join_case_v3의 최종 검증은 그대로 둔다 — 이 함수는 UX와 SMS 낭비를 막는
 * 사전 관문일 뿐이고, 최종 방어선은 여전히 RPC다.
 *
 * *** 이 함수가 만드는 위험과 그 방어 ***
 * "코드가 유효한가"에 답하는 순간 이 경로는 가족코드 조회 오라클이 된다.
 * 지금까지 코드 추측은 join API를 통해서만 가능했고, 매 시도마다 검증된
 * OTP를 하나씩 소비했다(전화번호당 하루 10건). 사전 검증에 아무 비용이
 * 없으면 그 제한이 사라진다.
 *
 * 기존 OTP rate limit은 재사용할 수 없다. 그 제한은 phone_normalized 기준인데,
 * OTP 발송 전 단계에서는 그 번호를 본인이 소유했다는 증거가 없다 — 공격자가
 * 아무 번호나 바꿔 넣으면 제한이 즉시 무력화된다. 그래서 요청자 기준의 별도
 * 시도 기록(family_code_check_attempts)이 필요하다.
 *
 * 기록에는 IP 원문을 남기지 않는다. 서버 시크릿으로 HMAC한 값만 저장한다.
 */

// 실패한 시도만 세는 짧은 창 — 오타 한두 번은 통과시키되 자동화된 추측은
// 곧바로 막는다.
const FAILED_WINDOW_MS = 10 * 60 * 1000;
const FAILED_LIMIT_PER_WINDOW = 10;

// 성공/실패를 모두 세는 하루 상한. 정상 사용자는 한 사례에 몇 번이면 끝난다.
const DAILY_ATTEMPT_LIMIT = 60;

const ATTEMPTS_TABLE = "family_code_check_attempts";

export class FamilyCodeCheckError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "FamilyCodeCheckError";
    this.status = status;
  }
}

function getSecret(): string {
  const secret = process.env.CAREGIVER_SESSION_SECRET;

  if (!secret) {
    throw new Error("CAREGIVER_SESSION_SECRET 환경변수가 없습니다.");
  }

  return secret;
}

/**
 * 요청자를 식별할 키. IP 원문은 저장하지도 로그에 남기지도 않는다 —
 * 시크릿으로 HMAC한 값만 쓴다(같은 IP는 같은 키로 모이고, 저장된 값에서
 * IP를 되돌릴 수는 없다).
 *
 * Vercel은 x-forwarded-for의 첫 항목에 실제 클라이언트 IP를 넣는다.
 * 헤더가 없으면 고정 키로 모아 최소한 전체 상한은 걸리게 한다.
 */
export function getClientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const ip = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";

  return crypto
    .createHmac("sha256", getSecret())
    .update(`family-code-check:${ip || "unknown"}`)
    .digest("hex");
}

/**
 * 시도 기록 저장소를 쓸 수 있는지 확인하고 한도를 검사한다.
 *
 * 저장소를 쓸 수 없으면(마이그레이션 미적용 등) null을 돌려준다. 그 경우
 * 호출부는 사전 검증을 아예 건너뛴다 — 제한 없는 조회 오라클을 여는 것보다,
 * 기존과 똑같이 OTP를 보내고 join_case_v3가 막게 두는 편이 안전하다.
 */
async function checkThrottle(
  clientKey: string
): Promise<{ record: (succeeded: boolean) => Promise<void> } | null> {
  const supabase = createSupabaseAdminClient();

  const windowStart = new Date(Date.now() - FAILED_WINDOW_MS).toISOString();

  const { count: failedCount, error: failedError } = await supabase
    .from(ATTEMPTS_TABLE)
    .select("attempt_id", { count: "exact", head: true })
    .eq("client_key", clientKey)
    .eq("succeeded", false)
    .gte("created_at", windowStart);

  if (failedError) {
    console.warn(
      "가족코드 사전 검증 저장소를 사용할 수 없어 사전 검증을 건너뜁니다:",
      failedError.code || failedError.message
    );
    return null;
  }

  if ((failedCount || 0) >= FAILED_LIMIT_PER_WINDOW) {
    throw new FamilyCodeCheckError("잠시 후 다시 시도해주세요.", 429);
  }

  const { count: dailyCount } = await supabase
    .from(ATTEMPTS_TABLE)
    .select("attempt_id", { count: "exact", head: true })
    .eq("client_key", clientKey)
    .gte("created_at", getKstDayStart().toISOString());

  if ((dailyCount || 0) >= DAILY_ATTEMPT_LIMIT) {
    throw new FamilyCodeCheckError("잠시 후 다시 시도해주세요.", 429);
  }

  return {
    record: async (succeeded: boolean) => {
      // 가족코드 값 자체는 저장하지 않는다 — 성공 여부만 남긴다.
      const { error } = await supabase
        .from(ATTEMPTS_TABLE)
        .insert({ client_key: clientKey, succeeded });

      if (error) {
        console.error("가족코드 검증 시도 기록 실패:", error.code || error.message);
      }
    },
  };
}

/**
 * 가족코드로 참여할 수 있는 사례가 있는지 확인한다. 없거나 이미 종료된
 * 사례면 FamilyCodeCheckError를 던진다.
 *
 * 반환값이 없다는 점이 중요하다 — case_id/환자명 등 어떤 사례 정보도 밖으로
 * 내보내지 않는다. 호출부가 아는 것은 "진행해도 되는지"뿐이다.
 */
export async function assertFamilyCodeJoinable(
  familyCode: string,
  clientKey: string
): Promise<void> {
  const trimmed = familyCode.trim();

  if (!trimmed) {
    throw new FamilyCodeCheckError("가족코드를 입력해주세요.", 400);
  }

  const throttle = await checkThrottle(clientKey);

  // 시도 기록을 남길 수 없으면 사전 검증을 하지 않는다(위 주석 참고).
  if (!throttle) {
    return;
  }

  const supabase = createSupabaseAdminClient();

  // status 외에는 아무것도 읽지 않는다. 환자명/사례번호는 이 단계에서 알
  // 필요가 없다.
  const { data: caseRow, error } = await supabase
    .from("cases")
    .select("status")
    .eq("family_code", trimmed)
    .limit(1)
    .maybeSingle();

  if (error) {
    // 가족코드 값은 로그에 남기지 않는다.
    console.error("가족코드 조회 실패:", error.code || error.message);
    throw new FamilyCodeCheckError("가족코드를 확인하지 못했습니다.", 500);
  }

  if (!caseRow) {
    await throttle.record(false);
    throw new FamilyCodeCheckError("가족코드를 확인해 주세요.", 400);
  }

  if (caseRow.status === "간병종료") {
    // 코드 자체는 맞았으므로 추측 시도로 세지 않는다. 안내 문구는 참여
    // API(join)가 같은 상황에서 쓰는 것과 같다.
    await throttle.record(true);
    throw new FamilyCodeCheckError("이미 간병이 종료된 사례입니다.", 400);
  }

  await throttle.record(true);
}
