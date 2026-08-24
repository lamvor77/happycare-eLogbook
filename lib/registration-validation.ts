/**
 * 구글폼/QR 등록 화면과 서버 API가 공유하는 순수 검증·정규화 함수 모음.
 * 이 파일은 클라이언트 컴포넌트에서도 import하므로 "server-only"를 쓰지
 * 않고, 암호화/복호화 같은 서버 전용 로직은 절대 넣지 않는다(그건
 * lib/caregiver-resident-number.ts가 담당한다 — 이 파일의 정규화 함수를
 * 내부에서 재사용한다).
 */

import { CONSENT_ITEMS, type ConsentKey } from "@/lib/registration-options";

/**
 * 간병인 주민등록번호(전체 13자리) 입력값에서 숫자만 추출해 13자리인지
 * 확인한다. 하이픈 유무는 상관없다("900101-1234567", "9001011234567" 모두
 * 허용). 형식이 다르면 null.
 */
export function normalizeResidentNumberDigits(input: string): string | null {
  const digits = input.replace(/[^0-9]/g, "");

  if (digits.length !== 13) {
    return null;
  }

  return digits;
}

export function isValidResidentNumberFormat(input: string): boolean {
  return normalizeResidentNumberDigits(input) !== null;
}

/** "900101-1234567" 형식으로 하이픈을 넣어 표시용 문자열을 만든다. */
export function formatResidentNumberWithHyphen(digits13: string): string {
  if (digits13.length !== 13) {
    return digits13;
  }

  return `${digits13.slice(0, 6)}-${digits13.slice(6)}`;
}

/**
 * 입력 중인 값에 자동으로 하이픈을 넣어준다(입력창 onChange에서 사용).
 * 숫자 6자리까지 입력되면 하이픈을 자동으로 붙이고, 전체 13자리를
 * 넘는 입력은 잘라낸다.
 */
export function autoFormatResidentNumberInput(rawValue: string): string {
  const digits = rawValue.replace(/[^0-9]/g, "").slice(0, 13);

  if (digits.length <= 6) {
    return digits;
  }

  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
}

export type BirthCentury = "1900" | "2000";

/**
 * 환자 생년월일 "6자리(YYMMDD)" + 세기 선택을 ISO date("YYYY-MM-DD")로
 * 변환한다. 6자리만으로는 세기를 알 수 없으므로(주민등록번호 뒷자리를
 * 받지 않기로 했으므로) 별도로 세기를 입력받아야 하며, 이 함수는 그
 * 세기값 없이 임의로 추정하지 않는다. 실제 존재하지 않는 날짜(예:
 * 02월 30일)는 null을 반환한다.
 */
export function normalizePatientBirthDateParts(
  yymmdd: string,
  century: BirthCentury
): string | null {
  const digits = yymmdd.replace(/[^0-9]/g, "");

  if (digits.length !== 6) {
    return null;
  }

  const yy = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const dd = digits.slice(4, 6);

  const year = `${century}`.slice(0, 2) + yy; // "19"/"20" + yy
  const month = Number(mm);
  const day = Number(dd);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const iso = `${year}-${mm}-${dd}`;
  const parsed = new Date(`${iso}T00:00:00Z`);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return iso;
}

/**
 * 환자 생년월일 "8자리(YYYYMMDD)"를 ISO date("YYYY-MM-DD")로 변환한다.
 * 4자리 연도를 그대로 받으므로 정규화 함수(normalizePatientBirthDateParts)와
 * 달리 세기 선택 입력이 필요 없다. 실제 존재하지 않는 날짜(예: 02월 30일)나
 * 8자리가 아닌 입력은 null을 반환한다 — 서버가 반드시 이 함수로 재검증한다.
 */
export function normalizePatientBirthDateYyyymmdd(input: string): string | null {
  const digits = input.replace(/[^0-9]/g, "");

  if (digits.length !== 8) {
    return null;
  }

  const year = digits.slice(0, 4);
  const mm = digits.slice(4, 6);
  const dd = digits.slice(6, 8);
  const month = Number(mm);
  const day = Number(dd);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const iso = `${year}-${mm}-${dd}`;
  const parsed = new Date(`${iso}T00:00:00Z`);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return iso;
}

/** 이미 "YYYY-MM-DD" 형식인 값(예: 기존 Google Form 연동)의 유효성만 확인한다. */
export function isValidIsoDate(input: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return false;
  }

  const parsed = new Date(`${input}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime());
}

/** 동의 6개 항목이 모두 true인지 확인한다. */
export function isConsentComplete(
  consents: Partial<Record<ConsentKey, boolean>>
): boolean {
  return CONSENT_ITEMS.every((item) => consents[item.key] === true);
}
