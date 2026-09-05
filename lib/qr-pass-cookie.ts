import "server-only";
import { cookies } from "next/headers";
import {
  computeQrPassExpiry,
  createQrPassValue,
  verifyQrPassValue,
  type QrPass,
} from "@/lib/qr-pass";

/**
 * QR pass 쿠키 입출력. 서명/검증 자체는 lib/qr-pass.ts(순수 함수)에 있다.
 *
 * 쿠키 속성:
 *   - HttpOnly: 스크립트가 읽을 수 없다(localStorage에 두지 않는 이유와 같다).
 *   - Secure  : production에서만(로컬 http 개발을 막지 않는다) — 세션 쿠키와
 *               같은 기준.
 *   - SameSite=Lax, Path=/
 *   - Max-Age : 만료까지 남은 초. 브라우저가 만료 시각에 스스로 지운다.
 *
 * 세션 쿠키(hc_caregiver_session)와는 별개다 — 로그인 여부와 "병원 QR을
 * 통과했는지"는 다른 사실이고, 한쪽이 지워져도 다른 쪽에 영향을 주지 않는다.
 */

export const QR_PASS_COOKIE = "hc_qr_pass";

function getSecret(): string {
  const secret = process.env.CAREGIVER_SESSION_SECRET;

  if (!secret) {
    throw new Error("CAREGIVER_SESSION_SECRET 환경변수가 없습니다.");
  }

  return secret;
}

export interface QrPassCookie {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: "lax";
    path: "/";
    maxAge: number;
  };
}

/**
 * 발급할 쿠키(이름·값·속성)를 만든다. Route Handler가 응답에 그대로 싣는다.
 * hospitalId는 get_public_hospital_v2로 방금 확인한 활성 병원이어야 한다.
 */
export function buildQrPassCookie(
  hospitalId: string,
  now: Date = new Date()
): QrPassCookie {
  const exp = computeQrPassExpiry(now);
  const value = createQrPassValue(hospitalId, exp, getSecret());
  const maxAge = Math.max(1, Math.floor((exp.getTime() - now.getTime()) / 1000));

  return {
    name: QR_PASS_COOKIE,
    value,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge,
    },
  };
}

/**
 * 현재 요청의 QR pass를 읽고 검증한다. 없거나 믿을 수 없으면 null.
 * (2단계에서 작성 API/작성 화면이 사용한다. 1단계에서는 발급만 한다.)
 */
export async function readQrPass(): Promise<QrPass | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(QR_PASS_COOKIE)?.value;

  return verifyQrPassValue(raw, getSecret());
}
