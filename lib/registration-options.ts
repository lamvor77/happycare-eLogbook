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
 * 입원 상태(입원 예정/입원 당일/입원 중). 이번 작업에서 화면에 새로 추가하는
 * 항목이다 — 기존 코드에 이 3단계를 저장하는 컬럼이 없다(cases.status는
 * "입원중"/"간병종료" 두 값만 쓰며, 이 3단계와 의미가 다르다). 그래서 이
 * 상수는 UI 표시/검증에만 쓰고, 아래 "등록 API" 문서에 명시된 대로 서버에는
 * 전송하되 cases.status에는 절대 매핑하지 않는다(docs/
 * registration-field-mapping.md 참고 — DB 컬럼이 아직 없는 항목으로 별도
 * 표시됨).
 */
export const ADMISSION_STATUS_OPTIONS: OptionItem[] = [
  { value: "입원_예정", label: "입원 예정" },
  { value: "입원_당일", label: "입원 당일" },
  { value: "입원_중", label: "입원 중" },
];

/**
 * 보험사 / 사고유형: 실제 구글폼이 이 저장소 밖에 있어(Google Apps
 * Script/Form) 정확한 선택값 목록을 코드에서 확인할 수 없었다. 임의로
 * 목록을 지어내지 않기 위해 강제 드롭다운으로 만들지 않고 자유 입력을
 * 유지한다(기존 CaseRegisterClient도 자유 입력이었다 — 동작 변경 없음).
 * 실제 구글폼 선택값을 확인할 수 있게 되면 이 배열을 채우고 화면을
 * <select>로 바꿀 것.
 */
export const INSURANCE_COMPANY_OPTIONS: OptionItem[] = [];
export const ACCIDENT_TYPE_OPTIONS: OptionItem[] = [];

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
