import crypto from "node:crypto";
import { getKstDayStart } from "./kst";

/**
 * 병원 QR 진입 증표(QR pass) — 순수 함수만.
 *
 * *** 왜 필요한가 ***
 * 간병일지는 "병원에 비치된 QR을 스캔한 뒤" 작성한다는 것이 운영 정책인데,
 * 지금까지 QR은 화면 진입점일 뿐이었다. 북마크·직접 URL·API 직접 호출로
 * QR 없이 작성할 수 있었다. 이 증표는 "이 브라우저가 최근에 어느 병원의
 * 정상 QR을 통과했다"는 사실을 서버가 검증 가능한 형태로 남긴다.
 *
 * *** 형식 ***
 *   1.<hospital_id>.<exp>.<sig>
 *     - 1            : 버전. 형식이 바뀌면 올린다(구버전은 전부 무효).
 *     - hospital_id  : UUID. 어느 병원 QR을 통과했는지.
 *     - exp          : 만료 시각(unix 초).
 *     - sig          : HMAC-SHA256(secret, "qr-pass:1:<hospital_id>:<exp>")
 *                      base64url.
 *
 * case_id·caregiver_id·환자 정보는 넣지 않는다. 증표는 "병원"만 말한다.
 *
 * *** 서명 도메인 분리 ***
 * 세션 토큰·OTP 해시와 같은 시크릿(CAREGIVER_SESSION_SECRET)을 쓰지만
 * 입력에 "qr-pass:1:" 접두사를 두어, 다른 용도의 HMAC 값을 이 증표로
 * 재활용할 수 없게 한다.
 *
 * 이 파일은 next/headers를 가져오지 않는다 — Node만으로 단위 테스트할 수
 * 있어야 하므로 쿠키 입출력은 lib/qr-pass-cookie.ts가 맡는다.
 */

export const QR_PASS_VERSION = "1";

/**
 * 증표 최대 수명. 만료는 "KST 다음 자정"과 "지금 + 이 값" 중 빠른 쪽이다.
 * 정책상 "한 번 스캔 = 그날 작성"이 원칙이고(care_date는 KST 하루 1건),
 * 이 상한은 자정 직후 스캔이 하루 종일 살아 있는 것을 막는 안전장치다.
 * 12시간 등으로 줄이려면 이 값만 바꾼다.
 */
export const QR_PASS_MAX_TTL_MS = 18 * 60 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface QrPass {
  hospitalId: string;
  /** 만료 시각(unix 초). */
  exp: number;
}

/**
 * KST 기준 다음 자정. getKstDayStart()가 "오늘 0시"를 절대 시각으로 주고,
 * KST는 서머타임이 없으므로 24시간을 더하면 정확히 내일 0시다.
 * 서버 시간대(Vercel은 UTC)에 의존하지 않는다.
 */
export function getNextKstMidnight(now: Date = new Date()): Date {
  return new Date(getKstDayStart(now).getTime() + 24 * 60 * 60 * 1000);
}

/**
 * 증표 만료 시각 = min(KST 다음 자정, now + QR_PASS_MAX_TTL_MS).
 */
export function computeQrPassExpiry(now: Date = new Date()): Date {
  const midnight = getNextKstMidnight(now).getTime();
  const capped = now.getTime() + QR_PASS_MAX_TTL_MS;
  return new Date(Math.min(midnight, capped));
}

function sign(hospitalId: string, exp: number, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`qr-pass:${QR_PASS_VERSION}:${hospitalId}:${exp}`)
    .digest("base64url");
}

/**
 * 쿠키에 넣을 증표 값을 만든다. hospitalId는 이미 검증된 값이어야 한다
 * (get_public_hospital_v2가 돌려준 활성 병원).
 */
export function createQrPassValue(
  hospitalId: string,
  exp: Date,
  secret: string
): string {
  if (!UUID_RE.test(hospitalId)) {
    throw new Error("hospital_id 형식이 올바르지 않습니다.");
  }

  const expSec = Math.floor(exp.getTime() / 1000);
  const normalizedId = hospitalId.toLowerCase();

  return `${QR_PASS_VERSION}.${normalizedId}.${expSec}.${sign(normalizedId, expSec, secret)}`;
}

/**
 * 증표 값을 검증한다. 어떤 이유로든 믿을 수 없으면 null — 형식 오류,
 * 버전 불일치, 서명 불일치, 만료, 그리고 "상한보다 먼 미래"의 exp(서명이
 * 맞아도 우리 서버가 발급했을 수 없는 값)까지 모두 같은 결과다. 호출부는
 * 이유를 구분하지 않는다(사용자에게는 "QR을 다시 스캔하라"는 안내 하나면
 * 된다).
 */
export function verifyQrPassValue(
  value: string | null | undefined,
  secret: string,
  now: Date = new Date()
): QrPass | null {
  if (typeof value !== "string" || value.length > 200) {
    return null;
  }

  const parts = value.split(".");

  if (parts.length !== 4) {
    return null;
  }

  const [version, hospitalId, expText, sig] = parts;

  if (version !== QR_PASS_VERSION) {
    return null;
  }

  if (!UUID_RE.test(hospitalId) || hospitalId !== hospitalId.toLowerCase()) {
    return null;
  }

  if (!/^\d{1,12}$/.test(expText)) {
    return null;
  }

  const exp = Number(expText);
  const nowSec = Math.floor(now.getTime() / 1000);

  if (exp <= nowSec) {
    return null;
  }

  // 우리 서버는 QR_PASS_MAX_TTL_MS보다 긴 증표를 만들지 않는다. 그보다 먼
  // 미래의 exp는 시크릿이 새어 나갔거나 발급 로직이 잘못된 경우뿐이다.
  if ((exp - nowSec) * 1000 > QR_PASS_MAX_TTL_MS) {
    return null;
  }

  const expected = sign(hospitalId, exp, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  return { hospitalId, exp };
}
