import "server-only";
import crypto from "node:crypto";
import { maskResidentNumberFront7 } from "@/lib/resident-number";
import {
  normalizeResidentNumberDigits,
  isValidResidentNumberFormat,
} from "@/lib/registration-validation";

/**
 * 간병인 주민등록번호(전체 13자리) 서버 전용 처리 모듈. 원문은 이 파일이
 * 아니면 절대 다루지 않는다 — 호출부(API 라우트)도 암호화 직후 원문 변수를
 * 더 이상 참조하지 않도록 스코프를 최소화해야 한다.
 *
 * 암호화 키: CAREGIVER_RRN_ENCRYPTION_KEY (base64로 인코딩된 32바이트,
 * 예: `openssl rand -base64 32`로 생성). NEXT_PUBLIC_ 접두사를 붙이지
 * 않는다. CAREGIVER_SESSION_SECRET과는 다른 별도의 키를 쓴다(용도가
 * 다르면 키도 분리 — 하나가 유출돼도 다른 하나는 안전).
 *
 * 알고리즘: AES-256-GCM. 매 호출마다 새 랜덤 IV(12바이트)를 쓰고, 인증
 * 태그를 별도 컬럼에 저장한다. key_version을 함께 저장해 향후 키를
 * 회전(rotate)해도 과거 데이터를 여전히 복호화할 수 있게 한다.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;

/**
 * 키를 회전하게 되면 이 값을 올리고, decryptResidentNumber()에서
 * key_version에 따라 적절한 키를 선택하도록 확장한다(현재는 버전 1 키
 * 하나만 존재).
 */
export const CURRENT_RRN_KEY_VERSION = 1;

function getEncryptionKey(): Buffer {
  const raw = process.env.CAREGIVER_RRN_ENCRYPTION_KEY;

  if (!raw) {
    throw new Error("CAREGIVER_RRN_ENCRYPTION_KEY 환경변수가 없습니다.");
  }

  const key = Buffer.from(raw, "base64");

  if (key.length !== 32) {
    throw new Error(
      "CAREGIVER_RRN_ENCRYPTION_KEY는 base64로 인코딩된 32바이트 키여야 합니다."
    );
  }

  return key;
}

export interface EncryptedResidentNumber {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

/** 하이픈 유무와 무관하게 13자리 숫자만 추출한다. 형식이 아니면 null. */
export function normalizeResidentNumber(input: string): string | null {
  return normalizeResidentNumberDigits(input);
}

export function validateResidentNumberFormat(input: string): boolean {
  return isValidResidentNumberFormat(input);
}

/**
 * "900101-1******" 형식으로 마스킹한다(앞 6자리 + 성별 식별 1자리만 노출,
 * 나머지는 전부 마스킹) — 기존 caregivers.resident_number_masked 형식(
 * lib/resident-number.ts)과 동일하게 맞춘다.
 */
export function maskResidentNumber(digits13: string): string {
  return maskResidentNumberFront7(digits13.slice(0, 7)) ?? "";
}

/**
 * 원문(13자리 숫자)을 AES-256-GCM으로 암호화한다. 반환값에는 원문이
 * 포함되지 않는다. 호출부는 이 함수 호출 이후 원문 변수를 더 이상 쓰지
 * 않아야 한다.
 */
export function encryptResidentNumber(digits13: string): EncryptedResidentNumber {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(digits13, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    keyVersion: CURRENT_RRN_KEY_VERSION,
  };
}

/**
 * 암호화된 값을 원문으로 되돌린다. 이번 작업에서는 어떤 API 라우트도 이
 * 함수를 호출하지 않는다(원문 조회 기능은 별도 후속 작업 — 관리자
 * 재인증/조회 사유/감사 로그를 갖춘 전용 기능으로 분리하기로 함, 작업 H
 * 참고). 서버 전용이며, 호출 결과를 로그로 남기지 않는다.
 */
export function decryptResidentNumber(encrypted: EncryptedResidentNumber): string {
  if (encrypted.keyVersion !== CURRENT_RRN_KEY_VERSION) {
    throw new Error(`지원하지 않는 key_version입니다: ${encrypted.keyVersion}`);
  }

  const key = getEncryptionKey();
  const iv = Buffer.from(encrypted.iv, "base64");
  const authTag = Buffer.from(encrypted.authTag, "base64");
  const ciphertext = Buffer.from(encrypted.ciphertext, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}
