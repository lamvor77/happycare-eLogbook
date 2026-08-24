# 해피간병 데이터 모델

이 문서는 실제 코드(`app/**`, `lib/**`, `types/domain.ts`, `app/api/**`)와
`supabase/migrations/**`의 SQL을 근거로 작성했다. 코드/마이그레이션에서
직접 확인되지 않은 컬럼·관계·제약은 "미확인"으로 명시하고, 추측으로
채우지 않았다. 원본 `cases`/`caregivers`/`hospitals`/`care_logs`/
`case_caregivers`/`care_log_photos`/`case_history` 테이블 자체는 이
리포지토리의 마이그레이션 이력에 `CREATE TABLE`이 없다(Supabase에서 이
저장소 밖에서 직접 생성됨) — 따라서 이 테이블들의 컬럼 목록은 `types/
domain.ts`, RLS 컬럼 단위 GRANT, 실제 select/insert 코드, `pre_rls_audit.sql`
점검 쿼리에서 실제로 참조되는 컬럼만 근거로 정리했다. 이 문서에 없는
컬럼이 DB에 더 있을 수 있다.

## 0. 서비스 범위 (2026-08-22 확정)

해피간병 전자일지는 가족간병 전체 업무관리 시스템으로 확장하지 않는다.
역할이 다음과 같이 분리되어 있다:

- **기존 가족간병관리 시스템**(이 저장소 밖, Google Form/Sheet/Apps
  Script 기반): 등록관리, 서류발급관리, 보험사/설계사/소개자/적립금
  관리 등 모든 업무관리의 최종 Source of Truth. 이 저장소는 이 시스템의
  테이블/관리 화면을 새로 만들지 않는다.
- **이 저장소(전자일지)**: 병원 QR, 간병인/환자 최초등록, Solapi OTP,
  간병인 세션, 현재 간병인, 전자간병일지, 위치정보, 사진, 관리자 일지
  확인까지로 범위가 제한된다.

전자일지에서 등록된 정보는 관리자가 다시 입력할 필요 없이 기존
시스템으로 자동 전송된다(`lib/legacy-sync.ts`,
[docs/legacy-sync-integration.md](./legacy-sync-integration.md),
[docs/legacy-family-care-field-map.md](./legacy-family-care-field-map.md))
— 이 저장소는 그 전송 상태(`cases.legacy_sync_status` 등)만 보관하고,
업무관리 마스터 데이터 자체는 갖지 않는다.

## 1. 시스템 개요

### 기술 스택 (`package.json` 기준)

- Next.js 16.2.9 (App Router) + React 19.2.4, TypeScript
- Tailwind CSS 4
- Supabase PostgreSQL (`@supabase/supabase-js` ^2.108.2, `@supabase/ssr` ^0.12.4)
- Supabase Auth: **관리자 로그인 전용**(이메일 + 비밀번호)
- Solapi SMS OTP: 간병인 최초 인증(자체 구현, Supabase Auth 미사용)
- HttpOnly 쿠키 기반 간병인 장기 세션(자체 `caregiver_sessions` 테이블)
- Vercel 배포

### 주요 사용자

| 사용자 | 인증 방식 | 권한 |
| --- | --- | --- |
| 관리자 | Supabase Auth(이메일+비밀번호) + `admin_users` 테이블 | 전체 사례 조회, 병원 관리, PDF 출력, 간병일지 삭제/복원 |
| 현재 간병인(`case_caregivers.is_current_caregiver = true`) | Solapi OTP 1회 + 장기 세션 쿠키 | 간병일지 작성, 현재 간병인 변경, 간병종료 처리 |
| 추가 가족간병인(현재 간병인이 아닌 연결) | 동일 | 사례/작성기록 조회만 가능, 작성 불가 |

### 핵심 흐름

```
병원 QR (app/log)
  → [최초 등록] 또는 [간병일지 작성] 또는 [가족간병인 추가]
  → (미인증 시) Solapi OTP 최초 1회 인증 → HttpOnly 쿠키(caregiver_sessions) 발급
  → register_case_v2 / join_case_v2 RPC → cases / case_caregivers 연결
  → 같은 브라우저에서는 세션 쿠키로 재인증 없이 계속 이용
  → 현재 간병인만 care_logs 작성 (requireCurrentCaregiverSession)
  → 일반 가족은 조회만 (requireCaseMemberSession)
  → 관리자는 별도 Supabase Auth 세션으로 조회·PDF 출력·간병일지 삭제/복원
```

Google Form 경로(`app/api/google-form-sync`)는 이 흐름과 별도로, 시크릿
헤더 검증 후 `cases` 테이블에 직접 upsert한다 — 3절 "등록 경로 통합"
참고.

## 2. 핵심 테이블 관계도

```mermaid
erDiagram
  HOSPITALS ||--o{ CASES : "hospital_id (FK 확인됨)"
  CASES ||--o{ CASE_CAREGIVERS : "case_id (FK 확인됨)"
  CAREGIVERS ||--o{ CASE_CAREGIVERS : "caregiver_id (FK 확인됨)"
  CASES ||--o{ CARE_LOGS : "case_id (FK 확인됨)"
  CAREGIVERS ..o{ CARE_LOGS : "caregiver_id 컬럼은 있으나 FK 없음(PGRST200 확인됨)"
  CARE_LOGS ||--o{ CARE_LOG_PHOTOS : "log_id (FK 여부 미확인)"
  CASES ||--o{ CASE_HISTORY : "case_id (컬럼 확인, FK 여부 미확인)"
  CAREGIVERS ||--o{ CAREGIVER_SESSIONS : "caregiver_id (FK 확인됨)"
  CAREGIVERS ..o{ CAREGIVER_OTP_CODES : "FK 없음 — phone_normalized 문자열로만 매칭"
  CAREGIVERS }o..o| AUTH_USERS : "auth_user_id (FK는 있으나 현재 간병인 로그인에는 미사용)"
  ADMIN_USERS }o--|| AUTH_USERS : "user_id (FK 확인됨)"
  CARE_LOGS }o..o| AUTH_USERS : "deleted_by (FK 확인됨, soft delete용)"
  CASES ||--o{ CASE_CONSENTS : "case_id (FK 확인됨)"
  CAREGIVERS ||--o{ CASE_CONSENTS : "caregiver_id (FK 확인됨)"
```

범례: `||--o{` = 확인된 FK, `..o{`/`}o..o|` = 코드상 연결되어 쓰이지만 DB
FK는 없거나 미확인. `AUTH_USERS`는 Supabase Auth의 `auth.users`(이
리포지토리가 정의하지 않는 Supabase 내장 테이블).

## 3. 테이블별 상세

### 3.1 hospitals

병원 QR 등록의 기준 테이블. `app/admin/hospitals/**`, `app/api/admin/
hospitals/**`, `app/api/hospitals/lookup`에서 관리한다.

| 컬럼 | 근거 | 비고 |
| --- | --- | --- |
| hospital_id | `types/domain.ts Hospital`, RLS GRANT | PK로 추정(모든 조회가 이 컬럼으로 `eq`) |
| hospital_name | 〃 | |
| hospital_address | 〃 | |
| hospital_phone | 〃 | |
| hospital_code | 〃 | QR 미사용 시 대체 식별자(`/log?h=...`) |
| qr_token | 〃 | QR 링크 식별자(`/log?q=...`) |
| status | 〃 | `"active"` / `"inactive"`(`app/api/admin/hospitals/[id]/route.ts`) |

RLS(`20260803120500_rls_policies.sql`): `status='active'`인 행은 anon도
SELECT 가능(컬럼 화이트리스트: 위 7개 컬럼만), 그 외 SELECT/INSERT/UPDATE/
DELETE는 `is_admin()`만 허용.

### 3.2 cases

간병 "사례" 단위. QR 최초 등록과 Google Form 등록이 모두 이 테이블로
수렴한다(3.9절 참고).

| 컬럼 | 근거 |
| --- | --- |
| case_id | `types/domain.ts CaseRecord`(PK로 추정) |
| case_no | 〃, `lib/case-no.ts`(`C{YYMMDD}-{랜덤4자}` 형식으로 생성) |
| registration_no | 〃, Google Form 동기화의 upsert 키(`onConflict: "registration_no"`). QR 등록(`source_type='hospital_qr'`)은 2026-08-22부터 서버가 `E{YYMMDD}-{3자리}` 형식으로 채번한다(`generate_e_registration_no()`, 5절) — 그 이전엔 항상 null이었다 |
| legacy_sync_status / legacy_synced_at / legacy_sync_error | `20260822090000_electronic_registration_no.sql` | 기존 가족간병관리 시스템으로의 전송 상태(`lib/legacy-sync.ts`). `pending`\|`synced`\|`failed`, Google Form 사례는 계속 null(동기화 대상 아님) — 8절 `POST /api/admin/cases/[id]/legacy-sync` 참고 |
| admission_status | `20260823090000_legacy_sync_field_map.sql` | 현재상태(`"입원 예정"`\|`"입원 당일"`\|`"입원 중"`, 기존 Sheet 표시값과 동일). `register_case_v3`의 `p_admission_status` 파라미터로 전달되어 **신규 사례 생성과 같은 트랜잭션 안에서** 저장된다(RPC 성공 후 별도 UPDATE 없음 — 2026-08-23 원자성 보완). 기존 사례 재사용 분기는 `cases`를 전혀 UPDATE하지 않으므로 이 값을 건드리지 않는다 |
| insurance_company_other | `20260823090000_legacy_sync_field_map.sql` | 보험사로 "기타"를 선택했을 때의 상세 입력값. `register_case_v3`의 `p_insurance_company_other` 파라미터로 전달되어 admission_status와 동일하게 신규 사례 생성 트랜잭션 안에서 저장된다. `insurance_company="기타"`일 때만 값이 있고, 그 외엔 null(RPC 내부에서도 `p_insurance_company <> '기타'`면 예외를 던져 강제) |
| source_type | 〃, `"hospital_qr"` \| `"google_form"` |
| family_code | 〃, 가족간병인 참여 코드(`FC-{timestamp}`) |
| patient_name / patient_birth_date / patient_phone / patient_gender | 〃 |
| diagnosis_name / room_no | 〃 |
| insurance_company / accident_type / accident_type_etc | 〃 |
| planner_name / planner_phone | 〃 |
| care_start_date / care_end_date | 〃 |
| memo | 〃 |
| status | 〃, `"입원중"` \| `"간병종료"` |
| privacy_agreed | `register_case_v2` insert(읽기 타입에는 없음 — insert 전용으로 보임) |
| hospital_id | 〃, `hospitals` FK(3.1 참고, 실제 embed 성공으로 FK 확인) |
| created_at | 〃 |

RLS: SELECT는 `case_id in (select my_case_ids())` 또는 `is_admin()`(캐어기버
경로는 실질적으로 service_role로 우회 — 4절 참고). INSERT는 정책 없음(RPC
전용), UPDATE는 현재 간병인 본인 또는 관리자만(`cases_update_current_caregiver`).

### 3.3 caregivers

| 컬럼 | 근거 | 비고 |
| --- | --- | --- |
| caregiver_id | `types/domain.ts Caregiver`(PK로 추정) | |
| caregiver_name | 〃 | |
| phone | 〃 | 레거시 원본 형식(하이픈 유무 혼재 가능) |
| phone_normalized | `20260803120000_caregiver_auth_link.sql` | E.164, 현재 로그인/등록 매칭 키 |
| auth_user_id | 〃, `uuid unique references auth.users(id) on delete set null` | **레거시**: Supabase Phone Auth 시절 컬럼. Solapi 전환 후 caregiver는 이 값을 채우지 않는다(4절 참고) |
| resident_number | `docs/privacy-data-policy.md`, `supabase/migrations/manual/cleanup_resident_number.sql` | **원문 주민등록번호(레거시)** — 신규 코드는 절대 쓰지 않음, RLS에서 select 권한 자체가 없음 |
| resident_number_masked | `lib/resident-number.ts`, `lib/caregiver-resident-number.ts`, `register_case_v2`/`join_case_v2`/`register_case_v3` insert | `900101-1******` 형식(앞 6자리+성별자리만, 나머지 마스킹) — v2/join_case_v2는 "앞 7자리만 입력" 기준, v3는 "전체 13자리 중 앞 7자리만 노출"로 계산 방식은 동일 |
| resident_number_ciphertext / resident_number_iv / resident_number_auth_tag / resident_number_key_version | `20260806090000_encrypt_caregiver_resident_number.sql`, `lib/caregiver-resident-number.ts` | **간병인 주민등록번호 전체 13자리의 AES-256-GCM 암호화 저장 컬럼**(신규). `register_case_v3`가 신규 caregiver 생성 시에만 채운다(재방문 시 덮어쓰지 않음). RLS 컬럼 GRANT에 포함되지 않음 — service_role만 접근(6절, `docs/privacy-data-policy.md` 3·6절) |
| otp_verified_at | `register_case_v2`/`join_case_v2`/`register_case_v3` insert | |
| created_at | RLS GRANT 목록 | |

RLS: SELECT는 `auth_user_id = auth.uid() or is_admin()`(캐어기버 경로는
service_role로 우회), 컬럼 화이트리스트에 `resident_number`와 암호화
4개 컬럼은 없음(원문·암호문 모두 비공개). INSERT/UPDATE/DELETE 정책
없음(RPC 전용).

### 3.4 case_caregivers

사례-간병인 연결. "누가 이 사례에 연결되어 있는가"와 "현재 간병인이
누구인가"를 함께 표현한다.

| 컬럼 | 근거 |
| --- | --- |
| case_caregiver_id | `types/domain.ts CaseCaregiver`(PK로 추정) |
| case_id | 〃, `cases` FK(embed 성공으로 확인) |
| caregiver_id | 〃, `caregivers` FK(embed 성공으로 확인) |
| relationship | 〃, 예: 배우자/부모/자녀/형제자매/지인/기타 |
| is_primary_caregiver | 〃 |
| is_current_caregiver | 〃, 사례당 최대 1명(부분 유니크 인덱스 `uq_case_caregivers_one_current`) |
| status | 〃, `"활성"` |

RLS: SELECT는 `case_id in (select my_case_ids())` 또는 `is_admin()`.
INSERT/UPDATE/DELETE 정책 없음 — 생성은 `register_case_v2`/`join_case_v2`,
현재 간병인 변경은 `set_current_caregiver_v2` RPC로만 수행.

### 3.5 care_logs

간병일지 본문. 감사 로그 성격이라 하드 삭제가 없고, 소프트 삭제만
지원한다(3.10절).

| 컬럼 | 근거 |
| --- | --- |
| log_id | `types/domain.ts CareLog`(PK로 추정) |
| case_id | 〃, `cases` FK(embed 성공으로 확인) |
| caregiver_id | 〃 — **컬럼은 존재하지만 `caregivers`를 향한 FK는 없다**(PGRST200 확인됨). 작성자 표시는 이 컬럼을 조인하지 않고 아래 `writer_name`/`signature_name` 스냅샷을 쓴다 |
| hospital_id | 〃 |
| care_date | 〃, 사례당 날짜 1건(활성 상태 기준, 3.10절 부분 유니크 인덱스) |
| meal_assist / move_assist / toilet_assist / hygiene_assist / position_change | 〃, boolean |
| memo | 〃 |
| relationship | 〃, 작성 시점의 관계 스냅샷(`case_caregivers.relationship`을 복사) |
| writer_name / signature_name | 〃, 작성 시점의 간병인 이름 스냅샷(`caregivers.caregiver_name`을 복사) |
| location_status | 〃, `"checked"` \| `"unavailable"`(레거시 값 `"not_used"`가 남아있을 수 있음 — `app/admin/page.tsx`가 별도 집계) |
| latitude / longitude | 〃, `location_status="checked"`일 때만 |
| location_checked_at | 〃 |
| location_failure_reason | 〃, `location_status="unavailable"`일 때 필수 |
| hospital_confirmed | `app/api/cases/[id]/care-logs/route.ts` insert(`true` 고정) | 읽기 타입에는 없음 |
| created_at | `types/domain.ts CareLog` | |
| deleted_at / deleted_by / delete_reason | `20260805090000_care_log_soft_delete.sql` | 소프트 삭제(3.10절), `deleted_by`는 `auth.users(id)` FK(관리자만) |

RLS: SELECT는 `case_id in (select my_case_ids())` 또는 `is_admin()`.
INSERT는 `care_logs_insert_current_caregiver`(현재 간병인 본인만,
`caregiver_id`/`case_id` 위조 불가). UPDATE는 기본 REVOKE, 예외로
`deleted_at`/`deleted_by`/`delete_reason` 3개 컬럼만 관리자에게
재허용(`care_logs_admin_soft_delete`). DELETE 정책 없음(하드 삭제 불가).

### 3.6 care_log_photos

RLS 정책(`care_log_photos_select`/`care_log_photos_insert`)과
`pre_rls_audit.sql`의 고아 데이터 점검 쿼리에서 `log_id` 컬럼 존재만
확인된다. **현재 이 테이블에 쓰는 신규 코드 경로가 없다** — 사진 업로드를
구현했던 레거시 `app/care-log/[id]/page.tsx`는 6단계에서 삭제되었고
(`docs/rls-rollout.md` 참고), 그 이후 신규 플로우(`app/api/cases/[id]/
care-logs`)는 사진 첨부를 구현하지 않았다. Storage 버킷 `care-log-photos`에
대한 RLS만 선제적으로 준비되어 있다(`20260803120500_rls_policies.sql`
8절). `care_logs`를 향한 FK 존재 여부는 코드로 확인할 수 없어 "미확인"으로
남긴다.

### 3.7 case_history

사례 단위 감사 이력. 등록/참여/현재간병인변경/간병일지작성/간병종료/
간병일지삭제/간병일지복원 등 각 API가 best-effort로 insert한다(insert
실패해도 주 액션은 롤백하지 않고 서버 로그만 남김).

| 컬럼 | 근거 |
| --- | --- |
| history_id | `types/domain.ts CaseHistoryEntry`(PK로 추정) |
| case_id | 〃 |
| history_type | 〃, 예: `REGISTER`, `JOIN`, `CAREGIVER_CHANGE`, `CARELOG`, `END`, `CARE_LOG_DELETE`, `CARE_LOG_RESTORE` |
| title / action / description | 〃, 사람이 읽는 요약(설계상 원문 간병내용·주민번호 등은 넣지 않음) |
| actor | 〃, 수행자 이름 또는 관리자 이메일(텍스트) |
| created_at | 〃 |
| created_by_id | 각 API의 insert(예: `app/api/cases/[id]/current-caregiver/route.ts`) | 캐어기버 액션에서만 채움(uuid). 관리자 액션(간병일지 삭제/복원)은 FK 대상이 불명확해 의도적으로 비움 |
| before_data / after_data | 각 API의 insert(jsonb) | 상태값 등 최소 정보만(예: `{status, care_end_date}`), 원문 전체를 넣지 않음 |

RLS: SELECT는 `case_id in (select my_case_ids())` 또는 `is_admin()`.
INSERT는 `case_id in (select my_case_ids())`(캐어기버 경로는 실제로는
service_role로 우회). UPDATE/DELETE 없음(불변 로그).

### 3.8 admin_users

| 컬럼 | 근거 |
| --- | --- |
| user_id | `20260803120050_admin_users.sql`, PK, `references auth.users(id) on delete cascade` |
| email | 〃 |
| created_at | 〃 |

`is_admin()` 함수(`select exists(select 1 from admin_users where user_id =
auth.uid())`)의 기준 테이블. `ADMIN_EMAILS` 환경변수(앱 레벨 인가)와는
별개로, DB RLS는 이 테이블만 본다 — 두 목록이 어긋나면 관리자가 로그인은
되지만 데이터를 못 보는 상태가 될 수 있다(`docs/rls-rollout.md` 4절).

### 3.9 caregiver_sessions / caregiver_otp_codes

Solapi OTP + 장기 세션 구조(`20260804090000_caregiver_session_tables.sql`,
`docs/solapi-caregiver-auth.md`). 둘 다 anon/authenticated에 대한 RLS
정책이 전혀 없어(RLS는 켜져 있지만 정책 0개 = 기본 전면 거부) 오직
`service_role`(`lib/supabase-admin.ts`)만 접근 가능하다.

**caregiver_sessions**

| 컬럼 | 비고 |
| --- | --- |
| session_id | PK, `gen_random_uuid()` |
| caregiver_id | `caregivers(caregiver_id)` FK, `on delete cascade` |
| token_hash | 원문 세션 토큰의 HMAC-SHA256 해시만 저장(원문 저장 금지), unique |
| expires_at | 기본 180일(`lib/caregiver-session.ts`) |
| revoked_at | 로그아웃/간병종료 시 채움 |
| last_used_at | 매 요청마다 갱신 |
| user_agent_hash | nullable, 현재 코드에서 값을 채우는 경로 없음(컬럼만 준비됨) |
| created_at | |

**caregiver_otp_codes**

| 컬럼 | 비고 |
| --- | --- |
| otp_id | PK |
| phone_normalized | **FK 없음** — 이 시점엔 아직 caregiver 행이 없을 수도 있어 전화번호 문자열로만 매칭 |
| code_hash | 원문 OTP 저장 금지, HMAC-SHA256(전화번호:코드) |
| expires_at | 발송 후 5분 |
| verified_at / consumed_at | 검증 성공 시각 / 등록·참여 폼에서 소비된 시각(15분 유예) |
| failed_attempts | 5회 초과 시 거부 |
| send_count / last_sent_at | 60초 재발송 쿨다운, 일일 10회 제한(`lib/otp.ts`) |
| created_at | |

### 3.10 case_consents

QR 최초 등록(`app/case-register`) 화면의 동의 6개 항목을 기록한다
(`20260806090100_case_consents.sql`). Google Form Sync와 `app/case-join`
(가족간병인 추가)은 이 테이블에 아무것도 쓰지 않는다(`docs/
registration-field-mapping.md` 참고).

| 컬럼 | 근거 |
| --- | --- |
| consent_id | PK, `gen_random_uuid()` |
| case_id | `cases(case_id)` FK, `on delete cascade` |
| caregiver_id | `caregivers(caregiver_id)` FK |
| consent_version | 동의 문구 버전(`lib/registration-options.ts`의 `CONSENT_VERSION`) |
| integrated_care_ward_confirmed / direct_care_confirmed / false_application_confirmed / insurance_not_guaranteed_confirmed / information_accuracy_confirmed / privacy_consent_confirmed | 6개 모두 `boolean not null`, 등록 시 전부 true여야 함(`register_case_v3`가 검증) |
| consented_at | 동의 시각 |
| created_at | |

IP/User-Agent는 저장하지 않는다(최소 수집 원칙, `docs/
privacy-data-policy.md` 1절 — 운영 확인 필요로 표시됨). RLS: SELECT는
`case_id in (select my_case_ids())` 또는 `is_admin()`. INSERT/UPDATE/
DELETE 정책 없음 — `register_case_v3`(SECURITY DEFINER)로만 생성되고
이후 불변(case_history와 동일 원칙).

### 3.11 소프트 삭제 정책(care_logs)

- 삭제: `deleted_at`/`deleted_by`/`delete_reason` 채움(하드 삭제 없음). 관리자만
  가능(`requireAdminApi()` + RLS `care_logs_admin_soft_delete`).
- 복원: 위 3개 컬럼을 다시 `null`로. 관리자만, 사유 5~500자 필수, 같은
  `case_id`+`care_date`에 활성(`deleted_at is null`) 행이 이미 있으면 거부(409).
- 최종 방어선: `uq_care_logs_case_date_active`(부분 유니크 인덱스,
  `(case_id, care_date) where deleted_at is null`) — 앱 코드의 사전 검사를
  동시 요청이 통과해도 DB가 최종적으로 막는다(23505 → 409 매핑).
- 일반 화면(`app/cases/[id]/**`)과 PDF(`app/admin/cases/[id]/print`)는
  `deleted_at is null`을 항상 붙여 삭제된 일지를 숨긴다. 관리자 전용
  `app/admin/cases/[id]/care-logs`만 `?includeDeleted=1`로 삭제분을 포함해
  볼 수 있다.

## 4. 인증/권한 구조

이 프로젝트는 **두 개의 완전히 분리된 인증 체계**를 쓴다. 섞어서 쓰지
않는다.

### 4.1 관리자 — Supabase Auth

- `lib/admin-auth.ts`의 `requireAdmin()`(페이지)/`requireAdminApi()`(API)가
  Supabase Auth 세션(`lib/supabase-server.ts`, 쿠키 바인딩)을 확인하고,
  이메일이 `ADMIN_EMAILS`(앱 레벨) 목록에 있는지 본다.
- 반환되는 `supabase` 클라이언트는 **관리자 본인의 인증 세션을 쓰는 RLS
  적용 클라이언트**다(service_role이 아님) — DB 레벨 인가는 `is_admin()`
  (=`admin_users` 테이블 조회)이 담당한다.
- 따라서 관리자로 로그인해도 `admin_users`에 등록되어 있지 않으면 RLS가
  막는다(`ADMIN_EMAILS`만으로는 DB를 통과 못함, `docs/rls-rollout.md` 참고).

### 4.2 간병인 — Solapi OTP + 자체 세션

- `lib/caregiver-auth.ts`가 담당. 간병인은 Supabase Auth를 전혀 쓰지
  않는다 — `auth.uid()`는 이 경로에서 항상 null이다.
- 로그인 상태는 `caregiver_sessions.token_hash`와 매칭되는 HttpOnly 쿠키로
  유지되고, 조회는 전부 `createSupabaseAdminClient()`(service_role, RLS
  우회)로 수행한다. 즉 **caregivers/cases/case_caregivers/care_logs/
  case_history에 대한 caregiver 경로의 실질적 권한 검증은 RLS가 아니라
  `lib/caregiver-auth.ts`의 애플리케이션 코드가 담당한다.**
- 두 단계 함수:
  - `requireCaseMemberSession(caseId)`: 로그인 + 이 사례에 활성 상태로
    연결됨(현재 간병인 여부 무관) — 조회 전용 화면(사례 상세, 통합
    간병일지, 사례 이력)에 사용. 사례 미존재(404)와 권한 없음(403)을
    구분해서 던진다.
  - `requireCurrentCaregiverSession(caseId)`: 위 조건 + 현재 간병인 +
    사례 상태 `입원중` — 쓰기 API(간병일지 작성, 현재 간병인 변경,
    간병종료)에 사용.
- `caregivers.auth_user_id`(3.3절)는 이 경로에서 더 이상 채워지지 않는
  레거시 컬럼이다 — 과거 Supabase Phone Auth 시절 데이터만 값을 갖고
  있을 수 있다.

### 4.3 RLS가 사실상 무력화되는 지점

`20260803120500_rls_policies.sql`의 `my_case_ids()`/`current_caregiver_id()`는
`auth.uid()` 기반이라, Solapi 세션으로 들어오는 요청(anon 키, JWT 없음)은
이 정책을 절대 통과하지 못한다(항상 빈 결과). 그래서 caregiver 화면들은
전부 `requireCaseMemberSession`/`requireCurrentCaregiverSession`이 반환하는
service_role 클라이언트로 조회한다 — RLS는 "꺼진 것"이 아니라 "이 경로에
대해서는 애초에 통과 대상이 아닌" 상태다. 반대로 관리자 경로는 여전히
RLS(`is_admin()`)를 그대로 통과해서 쓴다.

## 5. 등록 경로 통합 (QR 최초 등록 vs Google Form)

두 경로 모두 최종적으로 `cases` 테이블 한 곳에 모인다.

| | 병원 QR 최초 등록 | Google Form |
| --- | --- | --- |
| 진입점 | `app/case-register` → `POST /api/cases/register` | Apps Script → `POST /api/google-form-sync`(`docs/google-form-sync.md`) |
| 인증 | Solapi OTP 1회 + 세션 발급 | 시크릿 헤더(`x-happycare-sync-secret`) |
| DB 반영 | `register_case_v3` RPC(SECURITY DEFINER, service_role 호출) — 간병인 주민등록번호 암호화 저장 + `case_consents` 6개 항목까지 한 트랜잭션으로 처리 | `service_role` 클라이언트로 `cases.upsert()` 직접 |
| 중복 처리 | 같은 병원+환자명+생년월일로 "입원중" 사례가 있으면 재사용 | `registration_no` 컬럼에 `onConflict` upsert |
| `source_type` | `"hospital_qr"` | `"google_form"` |
| `case_no` | `register_case_v2` 내부에서 생성(`C{YYMMDD}-{랜덤4자}`) | 없으면 `lib/case-no.ts`의 `makeCaseNo()`로 생성 |
| `family_code` | `register_case_v2` 내부에서 생성(`FC-{epoch}`) | 없으면 `FC-{Date.now()}`, 기존 `registration_no` 매칭 시 기존 값 재사용 |
| 간병인 연결 | 등록과 동시에 `case_caregivers`에 현재 간병인으로 연결 | **연결하지 않음** — Google Form 경로는 caregiver/case_caregivers를 만들지 않고 `cases` 행만 생성/갱신한다. 이후 그 사례에 간병인이 연결되려면 별도로 QR "가족간병인 추가"(`case-join`, 가족코드 필요) 절차를 거쳐야 한다 |

이후 화면(사례 상세, 간병일지 작성/조회, PDF)은 `source_type`을 구분하지
않고 동일하게 동작한다 — `cases` 테이블 구조가 하나이기 때문에 통합이
가능하다.

## 6. 함수(RPC) 목록과 상태

| 함수 | 상태 | 비고 |
| --- | --- | --- |
| `register_case`, `join_case`, `set_current_caregiver` | **레거시(사실상 사용 불가)** | `auth.uid()` 필수 검증이 있는데 caregiver가 더 이상 Supabase Auth를 안 써서 항상 `not_authenticated`로 실패한다. 롤백/호환용으로 DB에는 남아있음 |
| `register_case_v2` | **레거시(호환용 유지, QR 등록은 더 이상 호출하지 않음)** | `app/api/cases/register/route.ts`가 `register_case_v3`로 전환됨(6절 아래 항목). v2 자체는 삭제하지 않았다 |
| `join_case_v2`, `set_current_caregiver_v2` | **현재 사용** | `auth.uid()` 대신 `phone_normalized`/서버가 이미 검증한 `caregiver_id`를 파라미터로 받음. `authenticated`/`anon`에 GRANT 없음 — service_role만 호출 가능 |
| `register_case_v3` | **현재 사용(QR 최초 등록), 파라미터 33개** | 최초 정의(31개 파라미터)는 `20260806090100_case_consents.sql`. 2026-08-22 `20260822090000_electronic_registration_no.sql`이 CREATE OR REPLACE로 재정의(신규 사례 생성 시 `generate_e_registration_no()`로 등록번호 채번 + `legacy_sync_status='pending'` 설정 추가, 파라미터 수는 그대로 31개). 2026-08-23 `20260823090000_legacy_sync_field_map.sql`이 `p_admission_status`/`p_insurance_company_other` 2개를 추가(총 33개)하며 이전 31개 파라미터 시그니처를 명시적으로 `drop`해 오버로드가 남지 않도록 함 — **운영 DB에도 이미 이 33개 파라미터 버전이 적용되어 있음을 2026-08-23 직접 조회로 확인함.** 두 값 모두 **신규 사례 생성 분기의 INSERT문에서만** 채워지며(같은 트랜잭션, RPC 성공 후 별도 UPDATE 없음), 기존 사례 재사용 분기는 `cases` 테이블을 전혀 UPDATE하지 않으므로 기존 사례의 admission_status/insurance_company/insurance_company_other를 포함해 어떤 `cases` 컬럼도 덮어쓰지 않는다. v2와 같은 신뢰 모델(service_role만 호출) + 간병인 주민등록번호는 암호화된 값(ciphertext/iv/auth_tag/key_version)만 파라미터로 받고 신규 caregiver 생성 시에만 필수로 검증 + `case_consents` 6개 항목을 같은 트랜잭션으로 insert. `app/case-join`(가족간병인 추가)은 여전히 `join_case_v2`를 쓴다 |
| `generate_e_registration_no()` | **신규(2026-08-22)** | `20260822090000_electronic_registration_no.sql`. `registration_no_counters`(날짜별 카운터, RLS 정책 없음 — service_role 전용) 테이블에 원자적 UPSERT로 날짜별 일련번호를 채번해 `E{YYMMDD}-{3자리}` 문자열을 반환한다. `register_case_v3`의 신규 사례 생성 분기에서만 호출됨 |
| `is_admin()` | 사용 중 | `admin_users` 조회, `SECURITY DEFINER` |
| `current_caregiver_id()`, `my_case_ids()` | **캐어기버 경로에서는 사실상 무력화**(4.3절) | 관리자 정책(`is_admin()`)의 OR 조건으로는 여전히 살아있음 |
| `get_public_hospital()` | 사용 중 | anon/authenticated 실행 가능, `status='active'` 병원만 최소 컬럼 반환 |

## 7. 서버 모듈 요약 (`lib/**`)

| 파일 | 역할 |
| --- | --- |
| `lib/supabase.ts` | anon 키 싱글턴(공개 조회용, 예: 병원 QR 조회) |
| `lib/supabase-admin.ts` | `service_role` 클라이언트(서버 전용, `server-only` 가드). 캐어기버 경로 전용 조회/쓰기, google-form-sync에서 사용 |
| `lib/supabase-server.ts` | 쿠키 바인딩 Supabase Auth 클라이언트(관리자 전용) |
| `lib/supabase-browser.ts` | 브라우저 클라이언트(관리자 로그인/로그아웃의 `auth.signInWithPassword`/`signOut`에만 사용, 테이블 직접 조회 없음) |
| `lib/admin-auth.ts` | 관리자 인가(`requireAdmin`/`requireAdminApi`) |
| `lib/caregiver-auth.ts` | 간병인 세션 인가(`requireCaseMemberSession`/`requireCurrentCaregiverSession`/`requireCaregiverPage` 등) |
| `lib/caregiver-session.ts` | 세션 토큰 발급/해시/폐기 |
| `lib/otp.ts` | Solapi OTP 발송/검증/소비 |
| `lib/solapi.ts` | Solapi SMS 발송 API 래퍼 |
| `lib/phone.ts` | 휴대폰번호 E.164 정규화 |
| `lib/resident-number.ts` | 주민등록번호 앞 7자리 마스킹(`join_case_v2` 경로용, "앞 7자리만 입력" 방식) |
| `lib/caregiver-resident-number.ts` | 간병인 주민등록번호 전체 13자리 정규화/형식검증/AES-256-GCM 암호화·복호화/마스킹(서버 전용, `register_case_v3` 경로용) |
| `lib/registration-options.ts` | 등록 화면 공통 상수(관계/성별/입원상태/동의 6항목 등, `docs/registration-field-mapping.md` 참고) |
| `lib/registration-validation.ts` | 등록 화면 공통 검증 함수(주민등록번호 형식, 환자 생년월일 6자리+세기 변환, 동의 완료 여부) — 클라이언트/서버 공용, 암호화 로직 없음 |
| `lib/case-no.ts` | `case_no` 생성 |
| `lib/request-guard.ts` | Origin/Referer 기반 동일 출처 검증(CSRF 방어) |
| `lib/legacy-sync.ts` | **신규(2026-08-22)**. 전자일지 → 기존 가족간병관리 시스템 아웃바운드 전송(`docs/legacy-sync-integration.md`). 간병인 주민등록번호 복호화는 이 파일이 유일한 호출부. payload key는 실제 기존 Sheet 헤더 문자열(`docs/legacy-family-care-field-map.md`) |
| `lib/legacy-registration-options.ts` | **신규(2026-08-23)**. 기존 Google Form의 보험사/사고유형 선택지를 서버가 대신 조회(5분 캐시 + 마지막 성공값 폴백, `docs/legacy-sync-integration.md` 2절). `GET /api/registration-options`의 유일한 호출부 |

## 8. API 라우트 요약 (`app/api/**`)

| 경로 | 인증 | 비고 |
| --- | --- | --- |
| `GET /api/hospitals/lookup` | 없음(공개) | QR 토큰/코드로 병원 최소 정보 조회 |
| `POST /api/google-form-sync` | 시크릿 헤더 | `cases` upsert, service_role |
| `POST /api/caregiver-auth/send-otp` | 없음(레이트리밋만) | |
| `POST /api/caregiver-auth/verify-otp` | 없음 | 성공 시 기존 caregiver면 즉시 세션 발급 |
| `POST /api/caregiver-auth/logout` | 세션 쿠키 | |
| `GET /api/caregiver-auth/session` | 세션 쿠키(소프트) | 로그인 여부만 반환 |
| `POST /api/cases/register` | 세션 있으면 재사용, 없으면 OTP 소비 필요 | `register_case_v3`(간병인 주민등록번호 암호화 + 동의 6항목 포함) |
| `POST /api/cases/join` | 〃 | `join_case_v2` |
| `POST /api/cases/[id]/care-logs` | `requireCurrentCaregiverSession` | 하루 1건 제한(활성 행 기준) |
| `POST /api/cases/[id]/current-caregiver` | `requireCurrentCaregiverSession` | `set_current_caregiver_v2` |
| `POST /api/cases/[id]/end-care` | `requireCurrentCaregiverSession` | 다른 활성 사례 없으면 세션 전체 폐기 |
| `GET/POST /api/admin/hospitals`, `GET/PATCH /api/admin/hospitals/[id]`, `POST .../regenerate-qr` | `requireAdminApi` | |
| `DELETE /api/admin/care-logs/[id]` | `requireAdminApi` | 소프트 삭제, 사유 5~500자 필수 |
| `POST /api/admin/care-logs/[id]/restore` | `requireAdminApi` | 복원, 사유 5~500자 필수, 날짜 충돌 시 409 |
| `POST /api/admin/cases/[id]/legacy-sync` | `requireAdminApi` | **신규(2026-08-22)**. 기존 가족간병관리 시스템 전송 실패 건 수동 재시도(`lib/legacy-sync.ts`) — 새 전송 로직 없이 기존 함수를 다시 호출 |
| `GET /api/registration-options` | 없음(공개, 민감정보 없음) | **신규(2026-08-23)**. QR 등록 화면의 보험사/사고유형 선택지 — `lib/legacy-registration-options.ts`를 통해 기존 Apps Script config를 대신 조회 |

## 9. 알려진 제약 / 후속 과제

- `care_logs.caregiver_id` → `caregivers` FK 없음(3.5절) — 작성자 이름이
  필요하면 `writer_name`/`signature_name` 스냅샷을 쓰거나, 꼭 다른 컬럼(예:
  전화번호)이 필요하면 `caregiver_id` 목록으로 `caregivers`를 별도 조회 후
  Map으로 결합한다(PostgREST 임베드 금지 — `app/admin/location-unavailable/
  page.tsx`가 이 패턴의 예시).
- `caregivers.resident_number`(원문)는 레거시이며 RLS에서 이미 select
  불가. 완전 정리 절차는 `supabase/migrations/manual/cleanup_resident_number.sql`,
  `docs/privacy-data-policy.md` 8~9절 참고(운영 승인 필요, 자동 실행 안 함).
  기존 평문 → 암호화 컬럼 이행 절차는 `supabase/migrations/manual/
  migrate_caregiver_resident_number_to_encrypted.sql` 참고.
- `app/case-join`(가족간병인 추가)은 이번 암호화 저장 전환 범위에
  포함되지 않았다 — 여전히 "주민등록번호 앞 7자리(선택)"만 받고
  `join_case_v2`를 그대로 호출한다(`docs/registration-field-mapping.md`
  참고 항목).
- `care_log_photos`는 스키마 존재만 확인되고 실제 업로드 코드 경로가
  없다(3.6절).
- 관리자의 환자 PDF 열람에 대한 접근 로그가 없다(`docs/privacy-data-policy.md`
  11절, 후속 과제로 명시됨).
- `register_case`/`join_case`/`set_current_caregiver`(v1), `register_case_v2`
  함수가 DB에 남아있다 — 신규 QR 등록은 `register_case_v3`만 호출하지만,
  실수로 v1/v2를 다시 참조하지 않도록 주의할 것(6절).
- `admission_status`(입원 예정/입원 당일/입원 중) 항목은 QR 등록 화면에서
  수집하지만 대응하는 DB 컬럼이 없어 서버가 값을 버린다(3.2절 `cases.status`
  와는 의미가 다름, `docs/registration-field-mapping.md` 참고).
- 간병인 주민등록번호 전체 13자리 수집의 법적 근거·보유기간·파기절차는
  "운영 확인 필요"로 남아 있다(`docs/privacy-data-policy.md` 7·10절) —
  코드가 이를 대신 결정하지 않는다.
- SQL 마이그레이션은 이 리포지토리에서 **자동 실행되지 않는다** — 운영
  DB에 실제로 적용됐는지는 이 문서만으로 알 수 없고, `supabase/
  migrations/checks/`의 점검 스크립트로 직접 확인해야 한다.
- 기존 가족간병관리 시스템과의 연동은 "호출하는 쪽"만 구현되어 있다 —
  실제 등록 수신 엔드포인트(`LEGACY_FAMILYCARE_WEBHOOK_URL`)와 보험사
  옵션 조회 엔드포인트(`LEGACY_FAMILYCARE_CONFIG_URL`)는 운영팀이
  별도로 구축/배포해야 하고, 그때까지는 모든 신규 QR 등록이
  `legacy_sync_status='failed'`(`not_configured`)로 남고 보험사 목록은
  빈 배열로 내려간다(등록 자체는 정상 처리됨). 실제 Sheet 헤더는
  2026-08-23에 확인되었지만(`docs/legacy-family-care-field-map.md`),
  "5. 확인 및 동의"/"타임스탬프"/"종료일"/"비고" 값 형식과 실제
  엔드포인트 URL/인증 방식은 아직 확인되지 않았다(같은 문서 "운영팀
  확인이 필요한 항목" 참고).
