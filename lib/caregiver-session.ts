import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const CAREGIVER_SESSION_COOKIE = "hc_caregiver_session";

const SESSION_TTL_DAYS = 180; // 180일 또는 사례 종료 중 빠른 시점(사례 종료
// 여부는 매 요청마다 별도로 확인한다 — lib/caregiver-auth.ts 참고)

function getSecret(): string {
  const secret = process.env.CAREGIVER_SESSION_SECRET;

  if (!secret) {
    throw new Error("CAREGIVER_SESSION_SECRET 환경변수가 없습니다.");
  }

  return secret;
}

export function hashSessionToken(rawToken: string): string {
  return crypto.createHmac("sha256", getSecret()).update(rawToken).digest("hex");
}

function generateRawToken(): string {
  // 32바이트 이상의 무작위 토큰(base64url).
  return crypto.randomBytes(33).toString("base64url");
}

/**
 * 새 간병인 세션을 생성하고 HttpOnly 쿠키를 발급한다. caregiverId는 이미
 * 신뢰할 수 있는 값이어야 한다(OTP 검증 완료 또는 register_case_v2/
 * join_case_v2 성공 직후에만 호출할 것).
 */
export async function issueCaregiverSession(caregiverId: string): Promise<void> {
  const supabase = createSupabaseAdminClient();

  const rawToken = generateRawToken();
  const tokenHash = hashSessionToken(rawToken);
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { error } = await supabase.from("caregiver_sessions").insert({
    caregiver_id: caregiverId,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  if (error) {
    console.error("caregiver session 생성 실패:", error.message);
    throw new Error("세션 생성에 실패했습니다.");
  }

  const cookieStore = await cookies();

  cookieStore.set(CAREGIVER_SESSION_COOKIE, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

/**
 * 현재 요청의 세션 쿠키(원문 토큰)를 읽는다.
 */
export async function getRawSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(CAREGIVER_SESSION_COOKIE)?.value ?? null;
}

/**
 * 현재 세션을 해제(revoke)하고 쿠키를 지운다. 로그아웃에서 사용.
 */
export async function clearCaregiverSession(): Promise<void> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(CAREGIVER_SESSION_COOKIE)?.value;

  if (rawToken) {
    const supabase = createSupabaseAdminClient();
    const tokenHash = hashSessionToken(rawToken);

    await supabase
      .from("caregiver_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", tokenHash)
      .is("revoked_at", null);
  }

  cookieStore.delete(CAREGIVER_SESSION_COOKIE);
}

/**
 * 특정 caregiver의 모든 활성 세션을 해제한다. 간병종료 후 해당
 * caregiver에게 다른 입원중 사례가 없을 때 사용(구현 I).
 */
export async function revokeAllSessionsForCaregiver(caregiverId: string): Promise<void> {
  const supabase = createSupabaseAdminClient();

  const { error } = await supabase
    .from("caregiver_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("caregiver_id", caregiverId)
    .is("revoked_at", null);

  if (error) {
    console.error("caregiver session 일괄 해제 실패:", error.message);
  }
}
