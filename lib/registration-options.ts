/**
 * 구글폼 등록과 QR 최초 등록(및 가족간병인 참여)이 같은 선택값을 쓰도록
 * 모아둔 공통 상수. 저장값은 기존 코드가 실제로 쓰고 있던 값을 그대로
 * 유지한다(app/case-register/CaseRegisterClient.tsx, app/case-join/
 * CaseJoinClient.tsx의 기존 <select> 옵션 기준) — 임의로 새 값을 만들지
 * 않았다.
 */

export interface OptionItem {
  value: string;
  label: string;
}

/**
 * 환자와의 관계. 기존 CaseRegisterClient/CaseJoinClient의 <select> 옵션과
 * 동일한 저장값을 그대로 사용한다.
 */
export const RELATIONSHIP_OPTIONS: OptionItem[] = [
  { value: "배우자", label: "배우자" },
  { value: "부모", label: "부모" },
  { value: "자녀", label: "자녀" },
  { value: "형제자매", label: "형제자매" },
  { value: "지인", label: "지인" },
  { value: "기타", label: "기타" },
];

/**
 * 환자 성별. 기존 저장값 "남"/"여"를 그대로 유지한다(표시 라벨도 동일하게
 * 맞춰 표시·저장 값 불일치를 만들지 않는다).
 */
export const PATIENT_GENDER_OPTIONS: OptionItem[] = [
  { value: "남", label: "남" },
  { value: "여", label: "여" },
];

/**
 * 현재상태(입원 예정/입원 당일/입원 중). 기존 가족간병관리 Sheet의
 * `현재상태` 컬럼과 값이 정확히 같아야 하므로 저장값에 밑줄을 쓰지 않고
 * Sheet 표시값 그대로 공백으로 저장한다(2026-08-23 실제 Sheet 헤더 확인
 * 후 수정 — 이전에는 "입원_예정" 형태였다). `cases.admission_status`
 * 컬럼(`20260823090000_legacy_sync_field_map.sql`)에 저장되고, 여전히
 * `cases.status`("입원중"/"간병종료")와는 별개 값이다(임의로 매핑하지
 * 않음).
 */
export const ADMISSION_STATUS_OPTIONS: OptionItem[] = [
  { value: "입원 예정", label: "입원 예정" },
  { value: "입원 당일", label: "입원 당일" },
  { value: "입원 중", label: "입원 중" },
];

/**
 * 보험사: 2026-08-23부터 이 저장소에 하드코딩된 목록을 두지 않는다 —
 * 기존 Google Form의 "보험사" 질문 선택지를 단일 원본(Source of Truth)으로
 * 삼아 `GET /api/registration-options`가 매 요청마다 최신 값을 내려준다
 * (`app/api/registration-options/route.ts`, `lib/
 * legacy-registration-options.ts`). Form에서 선택지가 추가/삭제되면 이
 * 코드를 고치거나 재배포하지 않아도 다음 등록 화면부터 반영된다.
 */

/**
 * 사고유형: 기존 Google Form의 실제 선택값(질병/상해/교통사고)이
 * 2026-08-23에 확인되어 고정 상수로 둔다 — 서버도 이 3개 값 외에는
 * 거부한다(`app/api/cases/register/route.ts`). `/api/registration-options`
 * 응답에 값이 포함되면 그 값을 우선 쓰고, 응답이 없거나 실패하면 이
 * 상수를 기본값으로 쓴다(`CaseRegisterClient.tsx`).
 */
export const ACCIDENT_TYPE_OPTIONS: OptionItem[] = [
  { value: "질병", label: "질병" },
  { value: "상해", label: "상해" },
  { value: "교통사고", label: "교통사고" },
];

/** 보험사 선택지에서 "기타"를 고르면 자유 입력 필드를 추가로 보여준다. */
export const INSURANCE_COMPANY_OTHER_VALUE = "기타";

export const ACCIDENT_TYPE_ETC_VALUE = "기타";

export type ConsentKey =
  | "integrated_care_ward_confirmed"
  | "direct_care_confirmed"
  | "false_application_confirmed"
  | "insurance_not_guaranteed_confirmed"
  | "information_accuracy_confirmed"
  | "privacy_consent_confirmed";

/**
 * 등록 동의 6개 항목. 각 항목은 boolean이며, 6개 모두 true여야 등록 가능.
 * key는 supabase/migrations의 case_consents 컬럼명과 1:1로 맞춘다.
 */
export const CONSENT_ITEMS: { key: ConsentKey; label: string }[] = [
  {
    key: "integrated_care_ward_confirmed",
    label: "간호간병통합서비스 병동은 가족간병인 등록을 신청할 수 없음을 확인했습니다.",
  },
  {
    key: "direct_care_confirmed",
    label: "등록한 간병인 본인이 직접 간병함을 확인했습니다.",
  },
  {
    key: "false_application_confirmed",
    label: "허위로 신청할 경우 발생하는 불이익에 대해 확인했습니다.",
  },
  {
    key: "insurance_not_guaranteed_confirmed",
    label: "가족간병 등록이 보험금 지급을 보장하지 않음을 확인했습니다.",
  },
  {
    key: "information_accuracy_confirmed",
    label: "입력한 내용이 사실임을 확인했습니다.",
  },
  {
    key: "privacy_consent_confirmed",
    label: "개인정보 수집 및 이용에 동의합니다.",
  },
];

/** 현재 동의 문구 버전. 문구를 바꾸면 이 값도 함께 올릴 것. */
export const CONSENT_VERSION = "2026-08-06";
