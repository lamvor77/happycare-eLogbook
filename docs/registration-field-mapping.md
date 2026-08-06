# 등록 화면 항목 매핑 (Google Form ↔ QR 최초 등록 ↔ DB)

이 문서는 기존 Google Form 연동(`app/api/google-form-sync/route.ts`)과 QR
최초 등록 화면(`app/case-register/CaseRegisterClient.tsx`,
`app/api/cases/register/route.ts`)의 항목을 비교한다. "Google Form 항목"은
`app/api/google-form-sync/route.ts`의 `GoogleFormSyncBody` 인터페이스(=실제
Apps Script가 이 엔드포인트로 보낼 수 있는 필드) 기준이며, 실제 Google
Form 화면 자체는 이 저장소 밖에 있어 항목 문구까지는 확인할 수 없다.

## 간병인

| 구분 | Google Form 항목 | QR 등록 항목 | DB 컬럼 | 필수 | 현재 상태 | 변환 규칙 |
| --- | --- | --- | --- | --- | --- | --- |
| 간병인 성명 | **없음** | `caregiver_name` | `caregivers.caregiver_name` | QR: 세션 없을 때 필수 | Google Form Sync는 간병인을 아예 생성하지 않음(아래 "차이점" 참고) | 그대로 저장 |
| 간병인 주민등록번호 전체 13자리 | **없음** | `resident_number`(입력만, 서버로 전송 후 암호화) | `caregivers.resident_number_ciphertext`/`resident_number_iv`/`resident_number_auth_tag`/`resident_number_key_version`/`resident_number_masked` | QR: 세션 없을 때 필수 | 이번 작업에서 신규 구현. 원문은 어디에도 저장하지 않음 | 하이픈 제거 후 13자리 검증 → AES-256-GCM 암호화(`lib/caregiver-resident-number.ts`) → 암호문/IV/태그/키버전 저장, 별도로 마스킹값(`900101-1******`)도 저장 |
| 간병인 휴대전화 | **없음** | `caregiver_phone` | `caregivers.phone`, `caregivers.phone_normalized` | QR: 세션 없을 때 필수(Solapi OTP로 먼저 인증) | 변경 없음 | E.164 정규화(`lib/phone.ts`) |
| 환자와의 관계 | **없음** | `relationship` | `case_caregivers.relationship` | 둘 다 관련은 있으나 Google Form은 caregiver를 안 만들어 저장 위치가 없음 | QR만 실제로 저장 | `RELATIONSHIP_OPTIONS`(`lib/registration-options.ts`) |

## 입원

| 구분 | Google Form 항목 | QR 등록 항목 | DB 컬럼 | 필수 | 현재 상태 | 변환 규칙 |
| --- | --- | --- | --- | --- | --- | --- |
| 현재 상태(입원 예정/입원 당일/입원 중) | **없음** | `admission_status`(화면에서만 수집) | **DB 컬럼 없음** | 아니오 | **화면에는 있지만 DB에 없는 항목** — `cases.status`("입원중"/"간병종료")는 의미가 달라 여기에 매핑하지 않는다(임의 매핑 금지 원칙) | 서버가 값을 받아도 저장하지 않고 버림(`app/api/cases/register/route.ts`에 명시 주석) — 후속 컬럼 추가 검토 필요 |
| 병원명 | 없음(구글폼은 hospital_id 개념이 없고 registration_no로만 매칭) | 읽기 전용, QR 토큰으로 서버가 재조회 | `cases.hospital_id` | 둘 다 사실상 필수(QR은 필수, Google Form은 애초에 병원 연결 없음) | Google Form 연동은 hospital_id를 아예 쓰지 않음(아래 "차이점") | QR: 서버가 `qr_token`/`hospital_code`로 재검증, 클라이언트가 보낸 hospital_id는 신뢰하지 않음 |
| 입원호실 | `room_no` | `room_no` | `cases.room_no` | 아니오 | 동일 | 그대로 저장 |
| 간병개시 예정일 | `care_start_date` | `care_start_date` | `cases.care_start_date` | 아니오 | 동일 | 그대로 저장(`date`) |
| 간병종료 예정일 | `care_end_date` | `care_end_date` | `cases.care_end_date` | 아니오 | 동일(QR 화면에 "선택"으로 유지) | 그대로 저장 |

## 환자

| 구분 | Google Form 항목 | QR 등록 항목 | DB 컬럼 | 필수 | 현재 상태 | 변환 규칙 |
| --- | --- | --- | --- | --- | --- | --- |
| 환자 성명 | `patient_name` | `patient_name` | `cases.patient_name` | 둘 다 사실상 필수 | 동일 | 그대로 저장 |
| 환자 생년월일 YYMMDD 6자리 | `patient_birth_date`(기존엔 완전한 날짜 문자열로 추정, 6자리 전송도 신규 지원) | `patient_birth_yymmdd` + `patient_birth_century` | `cases.patient_birth_date`(date) | 아니오(선택) | **선택값 형식이 서로 다름(통일 시도함)** | QR: 6자리+세기(1900대/2000대)를 서버에서 ISO date로 변환(`normalizePatientBirthDateParts`, 세기 임의 추정 금지 — 반드시 별도 입력받음). Google Form: 6자리(`^\d{6}$`)로 오면 같은 함수로 변환(`patient_birth_century` 필요), 아니면 기존처럼 그대로 통과(하위호환) |
| 환자 성별 | `patient_gender` | `patient_gender` | `cases.patient_gender` | 아니오 | 저장값 동일("남"/"여") | `PATIENT_GENDER_OPTIONS` |
| 환자 연락처 | `patient_phone` | `patient_phone` | `cases.patient_phone` | 아니오 | 동일 | 그대로 저장 |
| 진단명 | `diagnosis_name` | `diagnosis_name` | `cases.diagnosis_name` | 아니오 | 동일 | 그대로 저장 |
| 사고유형 | `accident_type`, `accident_type_etc` | `accident_type`, `accident_type_etc` | `cases.accident_type`, `cases.accident_type_etc` | 아니오 | 동일(자유 입력) | **선택값이 어느 쪽도 확정 목록이 아님** — 실제 Google Form의 선택 옵션을 이 저장소에서 확인할 수 없어 강제 드롭다운으로 만들지 않음(`ACCIDENT_TYPE_OPTIONS`는 빈 배열, 아래 "참고" 항목) |

## 보험

| 구분 | Google Form 항목 | QR 등록 항목 | DB 컬럼 | 필수 | 현재 상태 | 변환 규칙 |
| --- | --- | --- | --- | --- | --- | --- |
| 보험사 | `insurance_company` | `insurance_company` | `cases.insurance_company` | 아니오 | 동일(자유 입력) | 사고유형과 동일한 이유로 자유 입력 유지(`INSURANCE_COMPANY_OPTIONS` 빈 배열) |
| 담당설계사 | `planner_name` | `planner_name` | `cases.planner_name` | 아니오 | 동일 | 그대로 저장 |
| 설계사 연락처 | `planner_phone` | `planner_phone` | `cases.planner_phone` | 아니오 | 동일 | 그대로 저장 |

## 동의

| 구분 | Google Form 항목 | QR 등록 항목 | DB 컬럼 | 필수 | 현재 상태 | 변환 규칙 |
| --- | --- | --- | --- | --- | --- | --- |
| 간호간병통합서비스 병동 신청 불가 확인 | **없음** | `consents.integrated_care_ward_confirmed` | `case_consents.integrated_care_ward_confirmed` | QR: 필수 | **신규** — 기존엔 "개인정보 동의" 체크박스 1개뿐이었음 | 6개 모두 true여야 등록 가능 |
| 등록한 간병인이 직접 간병함을 확인 | **없음** | `consents.direct_care_confirmed` | `case_consents.direct_care_confirmed` | QR: 필수 | 신규 | 〃 |
| 허위 신청 관련 확인 | **없음** | `consents.false_application_confirmed` | `case_consents.false_application_confirmed` | QR: 필수 | 신규 | 〃 |
| 보험금 지급 보장 아님 확인 | **없음** | `consents.insurance_not_guaranteed_confirmed` | `case_consents.insurance_not_guaranteed_confirmed` | QR: 필수 | 신규 | 〃 |
| 입력 내용 사실 확인 | **없음** | `consents.information_accuracy_confirmed` | `case_consents.information_accuracy_confirmed` | QR: 필수 | 신규 | 〃 |
| 개인정보 수집·이용 동의 | **없음**(Google Form 응답 자체가 동의 후 제출되는 것으로 간주, `cases.privacy_agreed`는 sync 시 항상 `true`로 고정) | `consents.privacy_consent_confirmed` | `case_consents.privacy_consent_confirmed`, `cases.privacy_agreed` | QR: 필수 | 기존 QR 화면의 단일 체크박스를 대체 | `consent_version`과 함께 `case_consents`에 별도 기록(문구 버전 추적 가능) |

## 사실대로 표시: 차이점 정리

**화면에는 있지만 DB에 없는 항목**
- `admission_status`(입원 예정/입원 당일/입원 중): QR 등록 화면에서 수집하지만 저장 컬럼이 없다. 서버가 값을 받아도 버린다(임의로 `cases.status`에 매핑하지 않음).

**DB에는 있지만 QR 화면에서 받지 않는 항목**
- 없음(이번 재구성으로 기존 QR 화면이 다루던 `cases` 컬럼은 전부 화면에 남아 있음).

**Google Form Sync만 채우는 항목**
- `registration_no`, `case_no`(자동 생성 가능), `family_code`(자동 생성 가능) — Google Form 경로 고유의 중복 방지/매칭 키. QR 등록은 `registration_no`를 항상 `null`로 둔다.
- `source_type = "google_form"` (QR은 `"hospital_qr"`)

**QR 등록만 채우는 항목**
- 간병인 관련 전체(성명/주민등록번호/휴대전화/관계) — Google Form Sync는 `caregivers`/`case_caregivers`를 전혀 생성하지 않는다(`app/api/google-form-sync/route.ts`의 `GoogleFormSyncBody`에 해당 필드가 없음). 즉 Google Form으로 들어온 사례는 등록 시점에는 어떤 간병인과도 연결되지 않고, 이후 QR "가족간병인 추가"(`app/case-join`, 가족코드 필요) 절차를 별도로 거쳐야 간병인이 연결된다.
- `case_consents`(동의 6개) — Google Form Sync는 동의 레코드를 만들지 않는다(간병인이 없으므로 `case_consents.caregiver_id`를 채울 대상이 없음).
- `admission_status` — 화면 항목만 존재(위 참고).

**선택값이 서로 다른 항목**
- 환자 생년월일: Google Form은 기존에 완전한 날짜 문자열(예: `"1950-01-01"`)을 보냈던 것으로 보이고, QR은 이번 작업부터 "6자리 + 세기"로 입력받는다. 두 형식 모두 서버가 처리하도록 `lib/registration-validation.ts`의 `normalizePatientBirthDateParts()`를 공유한다.
- 보험사/사고유형: 실제 Google Form의 선택 옵션 목록을 이 저장소에서 확인할 수 없어(외부 Google Form/Apps Script), `lib/registration-options.ts`의 `INSURANCE_COMPANY_OPTIONS`/`ACCIDENT_TYPE_OPTIONS`를 빈 배열로 두고 두 화면 모두 자유 입력을 유지했다. 실제 목록을 확인할 수 있게 되면 이 상수를 채우고 두 화면을 `<select>`로 통일할 것.

## 참고: 이번 작업에서 다루지 않은 화면

- `app/case-join`(가족간병인 추가, `app/api/cases/join/route.ts`, `join_case_v2`)은 이번 작업 범위가 아니다. 여전히 "주민등록번호 앞 7자리(선택)"만 입력받고, 6개 동의 항목도 없다. 실제 업무상 추가 간병인에게도 전체 13자리가 필요하다면 후속 작업으로 `case-register`와 동일한 패턴(암호화 저장 + 동의 6개 + register_case_v3에 준하는 `join_case_v3`)을 적용해야 한다.
