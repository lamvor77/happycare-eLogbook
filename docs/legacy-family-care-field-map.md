# 기존 가족간병관리 시스템 필드 매핑

이 문서는 전자일지(QR 최초 등록, `app/case-register`)에서 수집한 등록정보를
기존 가족간병관리 시스템(Google Form/Sheet/Apps Script 기반, 이 저장소
밖에 있음)으로 자동 전송할 때 쓰는 필드 매핑을 정리한다. `lib/
legacy-sync.ts`가 실제로 보내는 payload와 이 문서는 항상 같아야 한다 —
필드를 추가/변경할 때는 이 문서도 함께 갱신한다.

## 1. 실제 Sheet 헤더 (2026-08-23 확인)

아래 28개 헤더가 실제 운영 화면에서 확인된 기존 가족간병관리 Google
Sheet의 컬럼명이다. 문자열을 임의로 바꾸지 않는다(예: `환자 성명`을
`환자명`으로 축약 금지, `5. 확인 및 동의`를 `동의`로 축약 금지) —
`lib/legacy-sync.ts`의 payload key도 아래 문자열을 그대로 쓴다.

```text
처리상태
등록번호
타임스탬프
현재상태
간병인 성명
간병인 주민등록번호
간병인 연락처
환자 성명
환자 생년월일
환자 연락처
환자 진단명
병원명
입원호실
보험사
담당설계사
설계사 연락처
검토메모
간병개시 예정일
종료일
5. 확인 및 동의
환자 성별
사고유형
기타인 경우 입력해주세요
비고
접수알림_보호자
접수알림_설계사
등록완료알림_보호자
등록완료알림_설계사
오류메모
```

## 2. 전체 컬럼 매핑

| 기존 Sheet 컬럼 | 전자일지 화면 | Supabase 내부 | outbound 변환 | 최초등록 전송 여부 | 비고 |
| --- | --- | --- | --- | --- | --- |
| 처리상태 | (없음) | (없음) | — | **전송 안 함**(전자일지 payload는 이 값을 포함하지 않음) | 신규 행 생성 시에만 수신측 Apps Script(`buildRowFromHeaderMap_`)가 "접수"를 기본값으로 채운다(전자일지가 정하는 값이 아니라 Sheet 쪽 규칙) — 기존 알림톡/후속 자동화가 이 값을 전제로 동작하기 때문(2026-08-24). 재전송(update)에서는 기존 값을 그대로 유지하고 "접수"로 되돌리지 않는다 |
| 등록번호 | (화면 미노출, 서버 생성) | `cases.registration_no` | `E{YYMMDD}-{3자리}`(작업 4) | **전송함** | 중복 방지 키 — 기존 시스템은 이 값 기준 upsert/중복거부 필요(작업 26) |
| 타임스탬프 | (없음) | `cases.created_at` | — | **전송 안 함** | 기존 Apps Script가 자동 생성하는 구조로 추정(운영팀 확인 필요) — 중복 타임스탬프 생성을 피하기 위해 이 저장소는 보내지 않는다 |
| 현재상태 | 현재상태(입원 예정/입원 당일/입원 중) | `cases.admission_status` | 화면 저장값 그대로("입원 예정" 등, 공백 포함 — Sheet 값과 동일하게 맞춤) | **전송함** | `ADMISSION_STATUS_OPTIONS`(`lib/registration-options.ts`) |
| 간병인 성명 | 간병인 성명 | `caregivers.caregiver_name` | 그대로 | **전송함** | Google Form Sync 경로는 caregiver를 만들지 않아 대응 없음 |
| 간병인 주민등록번호 | 간병인 주민등록번호(전체 13자리) | `caregivers.resident_number_ciphertext` 등(암호화 저장) | 전송 직전에만 복호화 → `formatResidentNumberWithHyphen()`(`lib/registration-validation.ts`, 화면 입력 검증과 동일 함수 재사용)으로 "900101-1234567" 형식 하이픈 삽입 후 전송(2026-08-25) | **전송함** | 업무상 필요해 평문 전송(작업 7) — API 로그/case_history/전자일지 관리자 화면에는 절대 노출하지 않는다. 하이픈 포맷은 payload 구성 시점(`lib/legacy-sync.ts`)에서만 적용하고 Apps Script는 개인정보를 재가공하지 않는다 — DB 저장값(암호문)/복호화 경계는 변경 없음 |
| 간병인 연락처 | 간병인 연락처 | `caregivers.phone` | outbound(legacy-sync.ts)는 그대로 전송하지만, **`caregivers.phone`은 실제로는 E.164 정규화값("+8210...")이 저장되어 있다**(`register_case_v3`가 `phone`/`phone_normalized` 두 컬럼에 같은 값을 넣음 — `docs/data-model.md`의 "레거시 원본 형식" 설명은 이 경로에는 더 이상 맞지 않음, 2026-08-24 확인). Sheet에 쓸 때는 Apps Script `formatPhoneForSheet_()`가 "010-1234-5678" 형식으로 다시 변환한다 | **전송함** | Sheet 표시 형식은 `docs/legacy-sync-integration.md` 10.7절 참고 |
| 환자 성명 | 환자 성명 | `cases.patient_name` | 그대로 | **전송함** | |
| 환자 생년월일 | 생년월일 8자리(YYYYMMDD) | `cases.patient_birth_date` | 서버가 `normalizePatientBirthDateYyyymmdd()`로 검증 후 ISO date(`YYYY-MM-DD`)로 저장·전송 | **전송함** | 형식이 Sheet 기존 값과 다를 수 있음(운영팀 확인 필요 — 다른 형식이 필요하면 `lib/legacy-sync.ts`에서 변환 추가) |
| 환자 연락처 | 환자 연락처 | `cases.patient_phone` | 화면에 입력한 원본 그대로(하이픈 유무 혼재 가능) 전송 | **전송함** | Sheet에 쓸 때는 Apps Script `formatPhoneForSheet_()`가 "010-1234-5678" 형식으로 변환한다(하이픈 없는 숫자 문자열을 그대로 쓰면 Sheets가 숫자로 인식해 앞자리 0이 사라짐, 2026-08-24 확인) — 상세는 `docs/legacy-sync-integration.md` 10.7절 |
| 환자 진단명 | 진단명 | `cases.diagnosis_name` | 그대로 | **전송함** | |
| 병원명 | (읽기 전용, QR로 확정) | `hospitals.hospital_name`(`cases.hospital_id` 조인) | 그대로 | **전송함** | 클라이언트가 보낸 병원명은 신뢰하지 않는다 — QR 토큰으로 서버가 재조회한 `hospital_id`의 실제 이름만 보낸다(작업 12) |
| 입원호실 | 입원호실 | `cases.room_no` | 그대로 | **전송함** | |
| 보험사 | 보험사(Google Form 동적 목록 select, 작업 15~19) | `cases.insurance_company` | 그대로("기타" 선택 시 문자열 그대로 "기타") | **전송함** | 목록은 `GET /api/registration-options`가 매 요청 최신값을 받아옴 — 이 저장소에 하드코딩 없음 |
| 담당설계사 | 담당설계사 | `cases.planner_name` | 그대로 | **전송함** | |
| 설계사 연락처 | 설계사 연락처 | `cases.planner_phone` | 화면에 입력한 원본 그대로(하이픈 유무 혼재 가능) 전송 | **전송함** | Sheet에 쓸 때는 Apps Script `formatPhoneForSheet_()`가 "010-1234-5678" 형식으로 변환한다 — 상세는 `docs/legacy-sync-integration.md` 10.7절 |
| 검토메모 | (없음) | (없음) | — | **전송 안 함** | 기존 시스템 후속 업무 전용(작업 25) |
| 간병개시 예정일 | 간병개시 예정일(`<input type="date">`, 작업 14) | `cases.care_start_date` | 그대로(`YYYY-MM-DD`) | **전송함** | |
| 종료일 | (없음) | `cases.care_end_date` | — | **전송 안 함** | 최초등록 시점엔 아직 확정되지 않는 값 — 기존 시스템의 종료 처리 업무에서 채워지는 컬럼으로 보고 전자일지가 최초 전송에 포함하지 않는다(운영팀 확인 필요) |
| 5. 확인 및 동의 | 확인 및 동의 6개 체크박스 | `case_consents.*`(6개 boolean, Supabase에는 그대로 저장됨) | 6개 모두 true일 때만 `LEGACY_CONSENT_RESPONSE`(`lib/legacy-sync.ts`) 고정 문자열, 아니면 `null` | **전송함(2026-08-25 확인 완료)** | **실제 Google Form 응답 문자열 확인 완료, 활성화됨.** 실제 정상 등록된 Form 행에서 확인한 문자열을 그대로 쓴다(임의로 만든 값 아님) — 6개 문장을 `", "`로 이어붙이고 각 문장 끝에 마침표+쉼표(`.,`)가 붙는 실제 형식을 그대로 유지한다. 전자일지 등록은 서버가 이미 6개 동의를 모두 강제하므로(`isConsentComplete`, `app/api/cases/register/route.ts`) 정상 등록 건은 항상 이 값이 채워진다 — `lib/legacy-sync.ts`가 전송 직전 `case_consents`를 다시 조회해 재확인한다(case_consents 저장 구조 자체는 미변경) |
| 환자 성별 | 성별(남/여) | `cases.patient_gender` | `"남"→"남자"`, `"여"→"여자"`(Sheet 표시값에 맞춤, DB 저장값은 그대로 유지) | **전송함** | `toSheetGender()`(`lib/legacy-sync.ts`) |
| 사고유형 | 사고유형(select, 질병/상해/교통사고 고정) | `cases.accident_type` | 그대로 | **전송함** | 서버가 이 3개 값 외에는 거부(작업 11) |
| 기타인 경우 입력해주세요 | 보험사 "기타" 선택 시 상세 입력 | `cases.insurance_company_other` | 보험사가 "기타"일 때만 값 전송, 아니면 null | **전송함** | Sheet 헤더가 하나뿐이라 보험사 "기타" 상세만 매핑한다 — 사고유형은 "기타" 선택지가 없다(운영팀 확인 필요: 이 컬럼이 사고유형 기타에도 쓰이는지) |
| 비고 | 비고 | `cases.memo` | — | **전송 안 함** | 기존 시스템에서 운영자가 직접 작성하는 후속 메모로 보고 최초 전송에는 포함하지 않는다(전자일지의 "비고" 화면 입력값은 현재 `cases.memo`에 저장되지만, 이 값을 그대로 기존 Sheet의 "비고"로 밀어넣을지는 운영팀 확인 필요 — 확인 전까지는 보수적으로 전송하지 않음) |
| 접수알림_보호자 | (없음) | (없음) | — | **전송 안 함** | 기존 시스템 알림 업무 전용(작업 25) |
| 접수알림_설계사 | (없음) | (없음) | — | **전송 안 함** | 〃 |
| 등록완료알림_보호자 | (없음) | (없음) | — | **전송 안 함** | 〃 |
| 등록완료알림_설계사 | (없음) | (없음) | — | **전송 안 함** | 〃 |
| 오류메모 | (없음) | (없음) | — | **전송 안 함** | 〃 |

## 3. 전자일지 전용 항목 (Sheet에 대응 컬럼 없음)

| 항목 | Supabase 컬럼 | 비고 |
| --- | --- | --- |
| 환자와의 관계 | `case_caregivers.relationship` | 현재 payload에는 포함하지 않는다 — Sheet에 대응 헤더가 없어 어느 컬럼으로 보내야 할지 확인되지 않음(운영팀 확인 필요) |
| 기타 사고유형 상세 | `cases.accident_type_etc` | 사고유형이 고정 3개 값(질병/상해/교통사고)으로 select化되어 "기타"를 애초에 고를 수 없다 — **2026-08-26부터 QR 화면 입력 UI도 제거**(운영 요청, 실제로는 항상 빈 값이었음). `cases.accident_type_etc` 컬럼/API 계약은 그대로 유지하고 QR 등록은 항상 `null`을 보낸다. payload에는 여전히 포함하지 않는다(기존과 동일) |

## 4. 전송하지 않는 이유 요약

- **후속 업무 전용 컬럼**(검토메모/종료일/비고/알림 4종/오류메모):
  기존 시스템에서 운영자가 직접 채우거나 그 시스템의 내부 로직이 채우는
  값으로, 전자일지가 최초 전송 시점에 임의의 값(특히 빈 문자열)으로
  덮어쓰면 기존 업무 흐름을 깨뜨릴 위험이 있다(작업 25) — 아예 payload에
  포함하지 않아 기존 Apps Script의 기본 처리(신규 행 생성 시 빈 값 유지
  등)에 맡긴다.
- **처리상태**(예외, 2026-08-24): 위 후속 업무 전용 컬럼과 마찬가지로
  전자일지 payload에는 포함하지 않지만, 신규 행 생성 시에만 수신측 Apps
  Script가 직접 "접수"를 기본값으로 채운다 — 기존 가족간병관리 시스템의
  알림톡/후속 자동화가 이 값이 "접수"인 것을 전제로 동작하기 때문이다.
  재전송(재시도/duplicate/update)에서는 이미 진행 중인 업무 상태를
  "접수"로 되돌리지 않는다. 상세 동작은
  [docs/legacy-sync-integration.md](./legacy-sync-integration.md)
  10.6절, 실제 구현은
  [docs/google-apps-script/legacy-webhook.gs](./google-apps-script/legacy-webhook.gs)의
  `buildRowFromHeaderMap_` 참고.
- **타임스탬프**: 기존 Apps Script가 자체적으로 생성하는 구조인지, 이
  저장소가 등록 시각을 보내야 하는 구조인지 확인되지 않아 보수적으로
  보내지 않는다.

## 5. 운영팀 확인이 필요한 항목 (요약)

1. `환자 생년월일`을 기존 Sheet가 어떤 문자열 형식으로 기대하는지(현재
   ISO `YYYY-MM-DD`로 전송 중).
2. ~~`5. 확인 및 동의` 컬럼이 실제로 기대하는 값 형식~~ — **2026-08-25
   확인 완료, 2절 표 참고.**
3. `타임스탬프`를 이 저장소가 채워 보내야 하는지, 기존 Apps Script가
   수신 시각으로 자동 생성하는지.
4. `종료일`/`비고`를 최초 전송에 포함해야 하는지(현재 보수적으로 미전송).
5. `기타인 경우 입력해주세요` 컬럼이 보험사 "기타"뿐 아니라 사고유형에도
   쓰이는지(현재 사고유형은 "기타" 선택지 자체가 없어 이 컬럼을 보험사
   전용으로만 쓰고 있음).
6. `환자와의 관계`를 기존 Sheet 어느 컬럼으로 보내야 하는지(현재 대응
   헤더가 없어 전송하지 않음).
7. 기존 Google Sheet/Apps Script가 간병인 주민등록번호를 평문으로
   저장하는 구조인지 여부 — 그렇다면 별도의 개인정보 보안 과제로
   다뤄야 한다(작업 29, 현재 운영 요구 없이 임의로 제거하지 않는다).

수신 측 웹훅 계약(요청 형식/인증/재시도)과 보험사 동적 조회 계약은
[docs/legacy-sync-integration.md](./legacy-sync-integration.md) 참고.
