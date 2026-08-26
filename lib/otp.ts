import "server-only";
import crypto from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { sendSms, SolapiError } from "@/lib/solapi";

const OTP_TTL_MS = 5 * 60 * 1000; // 5분 만료
const RESEND_COOLDOWN_MS = 60 * 1000; // 동일 번호 60초 재발송 제한
const DAILY_SEND_LIMIT = 10; // 동일 번호 하루 발송 횟수 제한
const MAX_FAILED_ATTEMPTS = 3; // 검증 실패 허용 횟수(4자리 전환에 맞춰 5->3, 2026-08-26)
const VERIFIED_REUSE_WINDOW_MS = 15 * 60 * 1000; // 인증 완료 후 등록/참여 폼 제출 유예시간

export class OtpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "OtpError";
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

function hashCode(phoneNormalized: string, code: string): string {
  return crypto
    .createHmac("sha256", getSecret())
    .update(`${phoneNormalized}:${code}`)
    .digest("hex");
}

// 4자리(0000~9999) — 앞자리 0도 그대로 유지되도록 항상 문자열로 다루고
// padStart로 채운다. 원문 코드는 저장하지 않고 hashCode()의 해시만
// caregiver_otp_codes.code_hash(text)에 저장하므로, 자릿수를 바꿔도 DB
// 스키마 변경이 필요 없다.
function generateCode(): string {
  return crypto.randomInt(0, 10_000).toString().padStart(4, "0");
}

/**
 * 로그/에러 메시지용 전화번호 마스킹. 원문 전화번호를 로그에 남기지 않기
 * 위한 용도로만 사용한다.
 */
export function maskPhone(phoneNormalized: string): string {
  if (phoneNormalized.length <= 7) return "****";
  return phoneNormalized.slice(0, 5) + "****" + phoneNormalized.slice(-2);
}

/**
 * OTP를 생성해 저장하고 SMS로 발송한다. 재발송 쿨다운(60초)과 일일 발송
 * 한도를 확인한다.
 */
export async function sendOtp(phoneNormalized: string): Promise<void> {
  const supabase = createSupabaseAdminClient();

  const { data: recent } = await supabase
    .from("caregiver_otp_codes")
    .select("last_sent_at")
    .eq("phone_normalized", phoneNormalized)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent?.last_sent_at) {
    const elapsed = Date.now() - new Date(recent.last_sent_at).getTime();

    if (elapsed < RESEND_COOLDOWN_MS) {
      throw new OtpError("잠시 후 다시 시도해주세요.", 429);
    }
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from("caregiver_otp_codes")
    .select("otp_id", { count: "exact", head: true })
    .eq("phone_normalized", phoneNormalized)
    .gte("created_at", todayStart.toISOString());

  if ((count || 0) >= DAILY_SEND_LIMIT) {
    throw new OtpError("오늘 인증 요청 횟수를 초과했습니다.", 429);
  }

  const code = generateCode();
  const codeHash = hashCode(phoneNormalized, code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  const { error } = await supabase.from("caregiver_otp_codes").insert({
    phone_normalized: phoneNormalized,
    code_hash: codeHash,
    expires_at: expiresAt,
    send_count: 1,
    last_sent_at: new Date().toISOString(),
  });

  if (error) {
    console.error("OTP 저장 실패:", error.message, maskPhone(phoneNormalized));
    throw new OtpError("인증코드 발송에 실패했습니다.", 500);
  }

  try {
    await sendSms(
      phoneNormalized,
      `[해피간병] 인증번호는 ${code}입니다. 5분 이내 입력해주세요.`
    );
  } catch (error) {
    if (error instanceof SolapiError) {
      throw new OtpError("인증코드 발송에 실패했습니다.", 502);
    }
    throw error;
  }
}

/**
 * OTP 코드를 검증한다. 성공 시 해당 행의 verified_at을 채운다. 실패 시
 * 실패 횟수를 증가시키고 OtpError를 던진다.
 */
export async function verifyOtpCode(phoneNormalized: string, code: string): Promise<void> {
  const supabase = createSupabaseAdminClient();

  const { data: row } = await supabase
    .from("caregiver_otp_codes")
    .select("otp_id, code_hash, expires_at, failed_attempts")
    .eq("phone_normalized", phoneNormalized)
    .is("verified_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) {
    throw new OtpError("인증코드가 올바르지 않거나 만료되었습니다.", 400);
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new OtpError("인증코드가 만료되었습니다. 다시 받아주세요.", 400);
  }

  if (row.failed_attempts >= MAX_FAILED_ATTEMPTS) {
    throw new OtpError(
      "인증 시도 횟수를 초과했습니다. 인증코드를 다시 받아주세요.",
      429
    );
  }

  const expectedHash = hashCode(phoneNormalized, code);

  if (expectedHash !== row.code_hash) {
    await supabase
      .from("caregiver_otp_codes")
      .update({ failed_attempts: row.failed_attempts + 1 })
      .eq("otp_id", row.otp_id);

    throw new OtpError("인증코드가 올바르지 않습니다.", 400);
  }

  const { error } = await supabase
    .from("caregiver_otp_codes")
    .update({ verified_at: new Date().toISOString() })
    .eq("otp_id", row.otp_id);

  if (error) {
    console.error("OTP 검증 상태 저장 실패:", error.message, maskPhone(phoneNormalized));
    throw new OtpError("인증 처리에 실패했습니다.", 500);
  }
}

/**
 * 최근(기본 15분 이내) 검증되었지만 아직 소비되지 않은 OTP가 있는지
 * 확인하고, 있으면 소비 처리(consumed_at)한다. 최초 등록/가족간병인
 * 참여 API가 "휴대폰 인증을 다시 요구하지 않기 위해" 사용한다.
 */
export async function consumeVerifiedOtp(phoneNormalized: string): Promise<boolean> {
  const supabase = createSupabaseAdminClient();

  const cutoff = new Date(Date.now() - VERIFIED_REUSE_WINDOW_MS).toISOString();

  const { data: row } = await supabase
    .from("caregiver_otp_codes")
    .select("otp_id")
    .eq("phone_normalized", phoneNormalized)
    .not("verified_at", "is", null)
    .is("consumed_at", null)
    .gte("verified_at", cutoff)
    .order("verified_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) {
    return false;
  }

  const { error } = await supabase
    .from("caregiver_otp_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("otp_id", row.otp_id);

  if (error) {
    console.error("OTP 소비 처리 실패:", error.message, maskPhone(phoneNormalized));
    return false;
  }

  return true;
}
