import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getRawSessionToken, hashSessionToken } from "@/lib/caregiver-session";

/**
 * 간병인 인증은 더 이상 Supabase Auth(Phone Provider)를 사용하지 않는다.
 * Solapi 기반 자체 SMS OTP로 휴대폰 소유를 1회 확인한 뒤, 자체 발급한
 * HttpOnly 세션 쿠키(caregiver_sessions 테이블)로 로그인 상태를 유지한다.
 * 이 파일의 모든 조회는 service_role 클라이언트(lib/supabase-admin.ts)로
 * 수행한다 — caregivers는 더 이상 Supabase Auth JWT를 갖지 않으므로 RLS의
 * auth.uid() 기반 정책은 이 경로에 적용되지 않는다(관리자 인증과는
 * 무관 — 관리자는 계속 Supabase Auth 이메일+비밀번호를 사용한다).
 */

export class CaregiverAuthError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CaregiverAuthError";
    this.status = status;
  }
}

/**
 * 세션 쿠키를 검증하고 연결된 caregiver를 반환한다(소프트 체크 — 실패해도
 * 예외를 던지지 않고 null을 반환한다). 유효하면 last_used_at을 갱신한다.
 */
export async function getCaregiverSession() {
  const rawToken = await getRawSessionToken();

  if (!rawToken) {
    return null;
  }

  const tokenHash = hashSessionToken(rawToken);
  const supabase = createSupabaseAdminClient();

  // caregivers(*)로 전체 컬럼을 가져오지 않는다 — 이 앱 전체에서 실제로
  // 쓰이는 필드는 caregiver_id/caregiver_name/phone_normalized뿐이다(모든
  // 호출부 확인됨). 주민등록번호 원문/마스킹/암호화 컬럼(resident_number*)
  // 은 매 요청마다 불필요하게 메모리로 가져올 이유가 없으므로 명시적으로
  // 제외한다.
  const { data: session } = await supabase
    .from("caregiver_sessions")
    .select(
      "session_id, caregiver_id, expires_at, revoked_at, caregivers (caregiver_id, caregiver_name, phone_normalized)"
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!session || session.revoked_at) {
    return null;
  }

  if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) {
    return null;
  }

  const caregiver = Array.isArray(session.caregivers)
    ? session.caregivers[0]
    : session.caregivers;

  if (!caregiver) {
    return null;
  }

  // 매 요청마다 재검증하므로 last_used_at도 매번 갱신한다(실패해도 로그인
  // 자체를 막지는 않는다).
  await supabase
    .from("caregiver_sessions")
    .update({ last_used_at: new Date().toISOString() })
    .eq("session_id", session.session_id);

  return { supabase, caregiver, sessionId: session.session_id as string };
}

/**
 * Route Handler(API)에서 사용한다. 세션이 없으면 CaregiverAuthError(401)를
 * 던진다.
 */
export async function requireCaregiverSession() {
  const session = await getCaregiverSession();

  if (!session) {
    throw new CaregiverAuthError("로그인이 필요합니다.", 401);
  }

  return session;
}

/**
 * 페이지(Server Component)에서 사용한다. 세션이 없으면
 * /caregiver-login?next=... 로 리다이렉트한다.
 */
export async function requireCaregiverPage(nextPath?: string) {
  const session = await getCaregiverSession();

  if (!session) {
    const next = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
    redirect(`/caregiver-login${next}`);
  }

  return session;
}

/**
 * 로그인한 caregiver가 caseId에 "활성 상태로 연결된 구성원"인지 확인한다
 * (현재 간병인 여부와는 무관 — 사례 상세/작성기록처럼 조회만 하는 화면에서
 * 쓴다). 클라이언트가 보낸 caregiver_id는 신뢰하지 않고, 항상 세션 쿠키로
 * 식별한 caregiver_id로만 확인한다.
 *
 * 사례 자체가 존재하지 않는 경우(404 성격)와, 사례는 있지만 이 caregiver가
 * 연결되어 있지 않은 경우(403 성격)를 구분해서 던진다 — 둘 다 case_id
 * 존재 여부/연결 여부만 확인할 뿐, 환자명 등 실제 사례 데이터는 이 함수
 * 안에서 절대 조회하지 않는다.
 */
export async function requireCaseMemberSession(caseId: string) {
  const { supabase, caregiver, sessionId } = await requireCaregiverSession();

  const { data: caseExists } = await supabase
    .from("cases")
    .select("case_id")
    .eq("case_id", caseId)
    .maybeSingle();

  if (!caseExists) {
    throw new CaregiverAuthError("사례 정보를 찾을 수 없습니다.", 404);
  }

  const { data: caseCaregiverData } = await supabase
    .from("case_caregivers")
    .select(
      "case_caregiver_id, is_current_caregiver, relationship, location_consent, location_consent_at, cases (status)"
    )
    .eq("case_id", caseId)
    .eq("caregiver_id", caregiver.caregiver_id)
    .eq("status", "활성")
    .maybeSingle();

  // Supabase가 다대일 관계(cases)를 배열로 추론하지만 실제로는 단일 객체다.
  const caseCaregiver = caseCaregiverData as unknown as
    | {
        case_caregiver_id: string;
        is_current_caregiver: boolean;
        relationship: string;
        location_consent: boolean | null;
        location_consent_at: string | null;
        cases: { status: string } | { status: string }[] | null;
      }
    | null;

  if (!caseCaregiver) {
    throw new CaregiverAuthError("이 사례에 접근할 권한이 없습니다.", 403);
  }

  return { supabase, caregiver, caseCaregiver, sessionId };
}

/**
 * caseId에 활성 상태로 연결된 구성원이고, 사례가 아직 "입원중"인지
 * 검증한다. 현재 간병인 여부는 보지 않는다.
 *
 * 간병일지 작성·정정·사진·위치동의가 이 조건을 쓴다 — 가족간병은 여러
 * 가족이 번갈아 돌보는 것이 실제 운영 형태라, "현재 간병인" 한 명에게만
 * 작성을 허용하면 나머지 가족이 매번 현재 간병인 변경을 거쳐야 하는
 * 불필요한 단계가 생긴다. 작성자 기록은 어차피 세션의 caregiver_id로
 * 남으므로(클라이언트 지정 불가) 누가 썼는지는 정확히 남는다.
 *
 * 간병종료된 사례는 세션이 유효해도 새 작성/변경을 항상 거부한다
 * (기존 기록 조회는 requireCaseMemberSession()으로 계속 허용된다).
 */
export async function requireActiveCaseMemberSession(caseId: string) {
  const { supabase, caregiver, caseCaregiver, sessionId } =
    await requireCaseMemberSession(caseId);

  const caseStatus = Array.isArray(caseCaregiver.cases)
    ? caseCaregiver.cases[0]?.status
    : caseCaregiver.cases?.status;

  if (caseStatus !== "입원중") {
    throw new CaregiverAuthError("간병이 종료된 사례입니다.", 400);
  }

  return { supabase, caregiver, caseCaregiver, sessionId };
}

/**
 * 위 조건에 더해 "현재 간병인 본인"까지 요구한다. 사례의 대표 상태를
 * 바꾸는 행위(현재 간병인 변경, 간병종료)에만 쓴다 — 간병일지 작성은
 * requireActiveCaseMemberSession()으로 충분하다.
 * 클라이언트가 보낸 값은 신뢰하지 않는다.
 */
export async function requireCurrentCaregiverSession(caseId: string) {
  const session = await requireActiveCaseMemberSession(caseId);

  if (!session.caseCaregiver.is_current_caregiver) {
    throw new CaregiverAuthError(
      "대표 간병인으로 등록된 경우에만 수행할 수 있습니다.",
      403
    );
  }

  return session;
}
