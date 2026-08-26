# 등록 화면 항목 매핑 (Google Form ↔ QR 최초 등록 ↔ DB)

이 문서는 기존 Google Form 연동(`app/api/google-form-sync/route.ts`)과 QR
최초 등록 화면(`app/case-register/CaseRegisterClient.tsx`,
`app/api/cases/register/route.ts`)의 항목을 비교한다. "Google Form 항목"은
`app/api/google-form-sync/route.ts`의 `GoogleFormSyncBody` 인터페이스(=실제
Apps Script가 이 엔드포인트로 보낼 수 있는 필드) 기준이며, 실제 Google
Form 화면 자체는 이 저장소 밖에 있어 항목 문구까지는 확인할 수 없다.

> **2026-08-22 갱신**: 전자일지는 기존 가족간병관리 시스템(이 Google
> Form이 속한 시스템)의 하위 기능이 아니라, QR/OTP/전자간병일지 범위로
> 역할이 확정되었다. QR 최초 등록에서 수집한 정보는 이제 등록 성공 시
> 기존 시스템으로 자동 전송된다 — 전송 대상 필드/변환 규칙은
> [docs/legacy-family-care-field-map.md](./legacy-family-care-field-map.md),
> 전송 방식(웹훅 계약)은
> [docs/legacy-sync-integration.md](./legacy-sync-integration.md) 참고.
> 아래 표의 QR 등록 항목 중 환자 생년월일/간병개시 예정일/사고유형은 이번
> 갱신으로 입력 방식이 바뀌었다(각 표의 해당 행 참고).
>
> **2026-08-23 갱신**: 실제 기존 가족간병관리 Google Sheet 헤더가
> 확인되어 `docs/legacy-family-care-field-map.md`를 그 헤더 기준으로
> 다시 작성했다. `admission_status`(현재상태)에 `cases.admission_status`
> 컬럼이 추가되어 더 이상 버려지지 않고 기존 시스템으로 전송된다.
> 보험사는 자유 입력에서 기존 Google Form 선택지를 동적으로 받아오는
> `<select>`로 바뀌었다(작업 15~19, `GET /api/registration-options`).

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
| 현재상태(입원 예정/입원 당일/입원 중) | **없음** | `admission_status` | `cases.admission_status`(2026-08-23 추가) | 아니오 | **2026-08-23부터 DB에 저장되고 기존 시스템으로 전송됨** — `register_case_v3`의 `p_admission_status` 파라미터로 전달되어 신규 사례 생성과 같은 트랜잭션 안에서 저장된다(별도 UPDATE 없음). `cases.status`("입원중"/"간병종료")와는 여전히 별개 값(임의 매핑 금지 원칙 유지) | 저장값을 Sheet의 `현재상태` 표시값과 동일하게 공백 포함("입원 예정" 등)으로 맞춤(`ADMISSION_STATUS_OPTIONS`) |
| 병원명 | 없음(구글폼은 hospital_id 개념이 없고 registration_no로만 매칭) | 읽기 전용, QR 토큰으로 서버가 재조회 | `cases.hospital_id` | 둘 다 사실상 필수(QR은 필수, Google Form은 애초에 병원 연결 없음) | Google Form 연동은 hospital_id를 아예 쓰지 않음(아래 "차이점") | QR: 서버가 `qr_token`/`hospital_code`로 재검증, 클라이언트가 보낸 hospital_id는 신뢰하지 않음 |
| 입원호실 | `room_no` | `room_no` | `cases.room_no` | 아니오 | 동일 | 그대로 저장 |
| 간병개시 예정일 | `care_start_date` | `care_start_date` | `cases.care_start_date` | 아니오 | **2026-08-22부터 QR 화면은 `<input type="date">`(모바일 달력)로 입력, 자유 텍스트 입력 제거** | 그대로 저장(`date`) |
| 간병종료 예정일 | `care_end_date` | `care_end_date`(2026-08-26부터 QR 화면 입력 UI 제거, 항상 `null` 전송) | `cases.care_end_date` | 아니오 | **QR 화면에서 입력란을 제거함(운영 요청)** — API 필드/DB 컬럼/`register_case_v3`의 `p_care_end_date`는 그대로 유지되고, 관리자/간병종료 기능이 이 컬럼을 쓰는 방식도 변경 없음. Google Form 경로는 영향 없음 | 그대로 저장(QR은 항상 `null`) |

## 환자

| 구분 | Google Form 항목 | QR 등록 항목 | DB 컬럼 | 필수 | 현재 상태 | 변환 규칙 |
| --- | --- | --- | --- | --- | --- | --- |
| 환자 성명 | `patient_name` | `patient_name` | `cases.patient_name` | 둘 다 사실상 필수 | 동일 | 그대로 저장 |
| 환자 생년월일 | `patient_birth_date`(기존엔 완전한 날짜 문자열로 추정, 6자리 전송도 지원) | `patient_birth_yyyymmdd`(8자리, 필수) | `cases.patient_birth_date`(date) | **QR: 필수(2026-08-22부터)** | **QR 화면은 8자리(YYYYMMDD) 필수 입력으로 변경, "(선택입력)" 문구와 19XX/20XX 세기 선택 UI 제거** | QR: 8자리를 서버에서 ISO date로 변환·실제 날짜 검증(`normalizePatientBirthDateYyyymmdd`). Google Form: 기존 방식(6자리+세기 또는 완전한 날짜 문자열) 그대로 유지 — `normalizePatientBirthDateParts()`는 계속 그 경로 전용으로 남겨둠, 이번 변경으로 건드리지 않음 |
| 환자 성별 | `patient_gender` | `patient_gender` | `cases.patient_gender` | 아니오 | 저장값 동일("남"/"여") | `PATIENT_GENDER_OPTIONS` |
| 환자 연락처 | `patient_phone` | `patient_phone` | `cases.patient_phone` | 아니오 | 동일 | 그대로 저장 |
| 진단명 | `diagnosis_name` | `diagnosis_name` | `cases.diagnosis_name` | 아니오 | 동일 | 그대로 저장 |
| 사고유형 | `accident_type`, `accident_type_etc` | `accident_type`, `accident_type_etc` | `cases.accident_type`, `cases.accident_type_etc` | 아니오 | **QR 화면은 2026-08-22부터 고정 select(질병/상해/교통사고)로 변경**(`accident_type_etc` 자유 입력은 유지) | `ACCIDENT_TYPE_OPTIONS`(`lib/registration-options.ts`)가 이 3개 값으로 채워짐 — 업무 지시로 고정한 값이며 실제 Google Form 옵션과 다를 수 있음(확인 필요, `docs/legacy-family-care-field-map.md` 참고). Google Form 경로는 여전히 자유 입력 |

## 보험

| 구분 | Google Form 항목 | QR 등록 항목 | DB 컬럼 | 필수 | 현재 상태 | 변환 규칙 |
| --- | --- | --- | --- | --- | --- | --- |
| 보험사 | `insurance_company` | `insurance_company` | `cases.insurance_company` | **QR: 필수(클라이언트 검증만, 2026-08-24부터)** / Google Form: 아니오 | **2026-08-23부터 QR 화면은 기존 Google Form의 실제 선택지를 동적으로 받아오는 `<select>`(+"기타" 자유입력)**, config 조회 실패 시 직접입력 fallback으로 전환되며 그 값도 동일하게 필수 검증 대상(작업: 등록 버튼 QA 수정) — 서버(`register_case_v3`)는 여전히 `p_insurance_company`를 nullable로 받아 강제하지 않는다(클라이언트만 막음) | `GET /api/registration-options` → `lib/legacy-registration-options.ts`가 기존 Apps Script config 엔드포인트를 조회(작업 15~19). Google Form 경로는 여전히 자유 입력 |
| 보험사 "기타" 상세 | **없음** | `insurance_company_other` | `cases.insurance_company_other`(2026-08-23 추가) | 아니오 | **신규** — 보험사로 "기타"를 선택했을 때만 값이 채워짐. `register_case_v3`의 `p_insurance_company_other` 파라미터로 전달되어 admission_status와 동일하게 신규 사례 생성 트랜잭션 안에서 저장(별도 UPDATE 없음, RPC 내부에서 `insurance_company≠"기타"`면 예외로 거부) | 기존 시스템으로 "기타인 경우 입력해주세요" 컬럼에 전송 |
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
- 없음(2026-08-23부터 `admission_status`도 `cases.admission_status`에 저장된다).

**DB에는 있지만 QR 화면에서 받지 않는 항목**
- 없음(이번 재구성으로 기존 QR 화면이 다루던 `cases` 컬럼은 전부 화면에 남아 있음).

**registration_no 형식이 서로 다름**
- Google Form: 외부 시스템이 보낸 값을 그대로 저장(예: `260821-001` 형식으로 추정, 실제 확인 불가), 중복 방지 upsert 키(`onConflict: "registration_no"`).
- QR 등록: 2026-08-22부터 서버가 `E{YYMMDD}-{3자리 일련번호}` 형식으로 채번해 저장한다(`generate_e_registration_no()`, `docs/legacy-family-care-field-map.md` 참고) — 이전에는 항상 `null`이었다. `E` 접두는 이 시스템 전용으로 예약되어 있어 Google Form 값과 겹치지 않는다.
- `case_no`(자동 생성), `family_code`(자동 생성)는 두 경로 모두 자체 생성한다.
- `source_type = "google_form"` (QR은 `"hospital_qr"`)

**QR 등록만 채우는 항목**
- 간병인 관련 전체(성명/주민등록번호/휴대전화/관계) — Google Form Sync는 `caregivers`/`case_caregivers`를 전혀 생성하지 않는다(`app/api/google-form-sync/route.ts`의 `GoogleFormSyncBody`에 해당 필드가 없음). 즉 Google Form으로 들어온 사례는 등록 시점에는 어떤 간병인과도 연결되지 않고, 이후 QR "가족간병인 추가"(`app/case-join`, 가족코드 필요) 절차를 별도로 거쳐야 간병인이 연결된다.
- `case_consents`(동의 6개) — Google Form Sync는 동의 레코드를 만들지 않는다(간병인이 없으므로 `case_consents.caregiver_id`를 채울 대상이 없음).
- `admission_status`/`insurance_company_other` — QR 등록만 채운다(Google Form 경로는 이 두 컬럼을 전혀 다루지 않는다).

**선택값이 서로 다른 항목**
- 환자 생년월일: Google Form은 기존 방식(완전한 날짜 문자열 또는 "6자리 + 세기")을 그대로 유지한다(`normalizePatientBirthDateParts()`). QR 등록은 2026-08-22부터 "8자리(YYYYMMDD, 필수)"로 바뀌었고 별도 함수(`normalizePatientBirthDateYyyymmdd()`)를 쓴다 — 두 경로가 서로 다른 함수를 쓰지만 둘 다 최종적으로 `cases.patient_birth_date`(ISO date)에 저장되는 것은 동일하다.
- 보험사: QR 등록은 2026-08-23부터 기존 Google Form의 실제 선택지를 동적으로 조회하는 `<select>`를 쓴다(`GET /api/registration-options`, `docs/legacy-sync-integration.md` 2절). Google Form 경로는 여전히 자유 입력이다(값이 그 Form에서 직접 들어오므로 검증할 필요가 없다).
- 사고유형: QR 등록 화면은 2026-08-22부터 실제 확인된 3개 값(질병/상해/교통사고, `ACCIDENT_TYPE_OPTIONS`)의 `<select>`를 쓴다(2026-08-23 확인 완료 — 더 이상 "다를 수 있음"이 아니라 확정값). Google Form 경로는 여전히 자유 입력이다.

## 참고: 이번 작업에서 다루지 않은 화면

- `app/case-join`(가족간병인 추가, `app/api/cases/join/route.ts`, `join_case_v2`)은 이번 작업 범위가 아니다. 여전히 "주민등록번호 앞 7자리(선택)"만 입력받고, 6개 동의 항목도 없다. 실제 업무상 추가 간병인에게도 전체 13자리가 필요하다면 후속 작업으로 `case-register`와 동일한 패턴(암호화 저장 + 동의 6개 + register_case_v3에 준하는 `join_case_v3`)을 적용해야 한다.
