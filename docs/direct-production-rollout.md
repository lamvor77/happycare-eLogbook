# 단일 운영 환경 직접 적용 가이드

## 이 문서를 쓰는 이유

이 프로젝트에는 실제로 분리된 "staging Supabase 프로젝트"나 "Vercel Preview
환경"이 존재하지 않는다(직전 확인 결과: 이 세션에는 Vercel CLI/프로젝트
연결, Supabase CLI/psql 접근 수단이 전혀 없고, `.env.local`에도
`NEXT_PUBLIC_` 두 변수 외에는 아무 것도 설정되어 있지 않다). 즉 지금
존재하는 Supabase/Vercel 환경은 사실상 **단일 환경(운영)** 이다.

이 문서는 AI가 대신 실행하지 않는다. **모든 단계는 사람이 Vercel
대시보드와 Supabase Dashboard(SQL Editor)에서 직접, 눈으로 프로젝트를
확인하며 순서대로 실행**하는 것을 전제로 작성했다. 실제 키, 이메일,
UUID, 전화번호는 전부 `<PLACEHOLDER>` 형태로만 표기한다.

**원칙**:
- 각 SQL 실행 직전, Supabase SQL Editor 상단의 프로젝트 이름/Project Ref가
  의도한 프로젝트가 맞는지 반드시 다시 확인한다.
- 각 단계 사이에 오류가 나면 즉시 멈추고 원인을 해결한 뒤에만 다음
  단계로 넘어간다. 여러 단계를 한 번에 몰아서 실행하지 않는다.
- `main` 브랜치 push는 이 문서의 10~11번 단계, 즉 **DB 쪽 준비가 전부
  끝난 뒤 마지막에** 한다. 지금(코드는 준비됐지만 DB는 아직) push하면
  로그인/등록/RLS에 의존하는 화면이 배포 즉시 깨질 수 있다.

---

## 1. Vercel Production 환경변수 설정 순서

1. https://vercel.com 로그인 → 해당 프로젝트 선택.
2. **Settings → Environment Variables** 이동.
3. 아래 5개를 **Production** 스코프로 추가한다(Preview도 쓴다면 동일하게
   추가, 단 서로 다른 Supabase 프로젝트를 쓰는 게 아니라면 값은 같아도
   무방):

   | Key | 값(placeholder) | 비고 |
   | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | `<SUPABASE_PROJECT_URL>` | 브라우저에 노출됨(정상) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `<SUPABASE_ANON_KEY>` | 브라우저에 노출됨(정상) |
   | `SUPABASE_SERVICE_ROLE_KEY` | `<SUPABASE_SERVICE_ROLE_KEY>` | **서버 전용**, `NEXT_PUBLIC_` 접두사 절대 금지 |
   | `GOOGLE_FORM_SYNC_SECRET` | `<GOOGLE_FORM_SYNC_SECRET>` | 임의의 긴 무작위 문자열 새로 생성 권장 |
   | `ADMIN_EMAILS` | `<ADMIN_EMAIL_1>,<ADMIN_EMAIL_2>` | 쉼표 구분, 공백 없이 |

4. 저장 후, **이미 배포된 인스턴스는 환경변수를 즉시 반영하지 않는다** —
   Deployments 탭에서 최신 배포를 **Redeploy**하거나, 이후 11번 단계의
   push로 새 배포가 트리거될 때 함께 반영되도록 한다.
5. 값을 저장한 뒤 Vercel UI에서 다시 열어 각 변수의 **이름**만 눈으로
   재확인한다(값은 마스킹되어 보통 다시 노출되지 않음).

---

## 2. Supabase Email/Phone Auth 설정 순서

Supabase Dashboard → 해당 프로젝트 → **Authentication → Providers**.

### 2-1. Email (관리자 로그인용 — `app/admin/login`이 이메일 OTP 사용)

1. **Email** provider가 Enabled인지 확인(기본 활성 상태인 경우가 많음).
2. **Authentication → Email Templates**에서 "Magic Link" 또는 "One-Time
   Password" 템플릿이 존재하는지 확인(기본 템플릿 사용 가능, 문구만
   한국어로 바꾸고 싶다면 여기서 수정 — 이번 단계 필수는 아님).
3. Rate limit(분당 발송량)이 관리자 인원 수 대비 충분한지 확인.

### 2-2. Phone (간병인 로그인/등록/참여용)

1. **Phone** provider를 **Enable**.
2. **Enable Phone Confirmations(OTP)** 를 켠다.
3. **SMS Provider** 섹션에서 공급자(Twilio 등)를 선택하고 아래 정보를
   입력한다(전부 placeholder):
   - Account SID: `<TWILIO_ACCOUNT_SID>`
   - Auth Token: `<TWILIO_AUTH_TOKEN>`
   - Messaging Service SID 또는 발신번호: `<TWILIO_MESSAGING_SID>`
4. 저장 후 Dashboard 내 "Send test SMS" 기능이 있다면 **본인 소유
   테스트 번호**로 1회 발송 테스트(문서에 실제 번호를 적지 않는다).

---

## 3. 관리자 Auth 사용자 생성 절차

1. Supabase Dashboard → **Authentication → Users → Add user**.
2. **Email**을 선택하고 `<ADMIN_EMAIL_PLACEHOLDER>` 자리에 실제 관리자
   이메일을 입력, 비밀번호는 설정하지 않거나(매직링크/OTP만 쓸 것이므로)
   임시 비밀번호를 생성 후 별도 보관한다.
3. 생성된 사용자 행을 클릭해 **User UID**를 확인한다 — 이 값을 5번
   단계에서 `<ADMIN_USER_UUID>` 자리에 사용한다. **이 UUID를 슬랙, 문서,
   커밋 메시지 등에 그대로 붙여넣지 않는다** — SQL Editor에서 그 순간만
   사용하고 폐기한다.
4. 필요한 관리자 수만큼(2-1 목록의 `ADMIN_EMAILS`와 동일 집합) 반복한다.

---

## 4. 20260803120000 및 20260803120050 적용 절차

**적용 전 공통 확인**: Supabase Dashboard 좌측 상단 프로젝트 선택기에서
지금 열려있는 프로젝트가 1~3번에서 환경변수/Auth를 설정한 바로 그
프로젝트인지 이름과 Project Ref로 다시 확인한다.

1. **SQL Editor → New query**.
2. `supabase/migrations/20260803120000_caregiver_auth_link.sql` 파일
   내용을 열어 그대로 붙여넣는다.
3. 파일 상단 주석의 "적용 전 체크리스트"를 먼저 읽는다(백필 UPDATE는
   기본적으로 주석 처리되어 있어 컬럼 추가 부분만 실행됨).
4. **Run** 클릭 → 에러 없이 완료되는지 확인.
5. 검증: Table Editor에서 `caregivers` 테이블을 열어
   `auth_user_id`, `phone_normalized`, `resident_number_masked` 컬럼이
   생겼는지 눈으로 확인(값은 비어 있는 게 정상).
6. 같은 방식으로 `supabase/migrations/20260803120050_admin_users.sql`을
   실행한다.
7. 검증: Table Editor에서 `admin_users` 테이블이 새로 생겼는지,
   컬럼이 `user_id, email, created_at`인지 확인.

두 파일 중 하나라도 에러가 나면 **즉시 중단**하고 에러 메시지를 그대로
복사해 원인을 파악한 뒤에만 재시도한다(다음 파일로 넘어가지 않는다).

---

## 5. admin_users 등록 SQL 템플릿

3번에서 확인한 UUID를 이용해 SQL Editor에서 실행한다(실제 값으로
치환해서 그 자리에서만 사용, 결과 화면을 캡처해 남기지 않는다):

```sql
insert into admin_users (user_id, email)
values ('<ADMIN_USER_UUID>', '<ADMIN_EMAIL_PLACEHOLDER>');
```

관리자가 여러 명이면 위 문장을 반복하거나 다음처럼 한 번에 처리한다:

```sql
insert into admin_users (user_id, email)
values
  ('<ADMIN_USER_UUID_1>', '<ADMIN_EMAIL_1>'),
  ('<ADMIN_USER_UUID_2>', '<ADMIN_EMAIL_2>');
```

등록 후 확인(값 노출 없이 건수만):

```sql
select count(*) as admin_users_count from admin_users;
```

`ADMIN_EMAILS` 환경변수(1번 단계)에 나열한 이메일 집합과 여기 등록한
이메일 집합이 **정확히 일치**하는지 육안으로 다시 대조한다.

---

## 6. 기존 caregiver auth_user_id 연결 SQL 템플릿

기존 caregiver는 아직 어떤 Auth 사용자와도 연결되어 있지 않다. 연결
전에는 해당 caregiver가 새 휴대폰 OTP 로그인으로 로그인할 수 없다.

### 6-1. 대상 파악(읽기 전용, 값 노출 없음)

```sql
select count(*) as caregivers_without_auth_user
from caregivers
where auth_user_id is null;
```

### 6-2. 개별 연결(소규모, 가장 안전)

1. Supabase Dashboard → Authentication → Users에서 해당 간병인의 휴대폰
   번호로 사용자를 생성(또는 이미 있으면 UID 확인).
2. SQL Editor에서:

   ```sql
   update caregivers
   set auth_user_id = '<CAREGIVER_AUTH_USER_UUID>',
       phone_normalized = '<CAREGIVER_PHONE_E164_PLACEHOLDER>'
   where caregiver_id = '<CAREGIVERS_CAREGIVER_ID>'
     and auth_user_id is null;
   ```

### 6-3. 전화번호 매칭 기반 일괄 연결(먼저 SELECT로 확인 후에만 UPDATE)

```sql
-- 1) 매칭 결과 미리보기(아무것도 변경하지 않음)
select cg.caregiver_id, au.id as would_link_auth_user_id
from caregivers cg
join auth.users au on au.phone = cg.phone_normalized
where cg.auth_user_id is null;

-- 2) 위 결과가 caregiver 1건당 auth 사용자 1건으로만 매칭될 때만 실행
update caregivers cg
set auth_user_id = au.id
from auth.users au
where au.phone = cg.phone_normalized
  and cg.auth_user_id is null;
```

전화번호 중복(pre_rls_audit의 phone_normalized 중복 항목)이 있는 행은
이 일괄 UPDATE 대상에서 제외하고 6-2번 방식으로 개별 처리한다.

### 6-4. 연결 확인(값 노출 없이 건수만)

```sql
select count(*) as caregivers_without_auth_user
from caregivers
where auth_user_id is null;
```

---

## 7. pre_rls_audit 실행 및 차단 조건 판정표

SQL Editor에서 `supabase/migrations/checks/pre_rls_audit.sql` 전체를
실행한다(섹션별로 나눠 실행해도 됨). 결과를 아래 표에 대입해 판정한다.

| 항목 | 쿼리 위치 | 통과 기준 | 차단 조건(하나라도 해당하면 8번으로 진행하지 않음) |
| --- | --- | --- | --- |
| auth_user_id 중복 | 5-1 | 0건 | **차단**: 1건 이상 |
| phone_normalized 중복 | 5-2 | 0건 (있어도 개별 검토 대상일 뿐 즉시 차단은 아님) | 참고용 — 6-3에서 제외 처리했는지만 확인 |
| 현재 간병인 2명 이상인 case | 4 | 0건 | **차단**: 1건 이상 |
| 현재 간병인 0명인 입원중 case | 4-1 | 0건이 이상적 | 경고(차단 아님) — 있으면 목록 기록 후 진행 가능, 단 후속 조치 필요 |
| case_caregivers 중복 연결 | 8-1 | 0건 | **차단**: 1건 이상 |
| orphan case_caregivers(case 없음) | 8 | 0건 | **차단**: 1건 이상 |
| orphan case_caregivers(caregiver 없음) | 8 | 0건 | **차단**: 1건 이상 |
| orphan care_logs(case 없음) | 9 | 0건 | **차단**: 1건 이상 |
| orphan care_log_photos | 9-1 | 0건 | 경고(차단 아님) — 있으면 원인 파악 후 진행 |
| orphan case_history | 9-2 | 0건 | 경고(차단 아님) |
| invalid location_status | 9-3 | 0건 | 경고(차단 아님) — 레거시 데이터일 수 있음 |
| checked인데 좌표 null | 9-4 | 0건 | 경고(차단 아님) |
| unavailable인데 사유 null | 9-5 | 0건 | 경고(차단 아님) |
| care_logs 중복(case_id+care_date) | 9-6 | 0건 | **차단**: 1건 이상 |
| admin_users 등록 수 | 10 | 1건 이상 | **차단**: 0건 |
| resident_number 원문 보유 건수 | 7 | 참고용(0이 이상적) | 차단 아님 — `docs/privacy-data-policy.md`/`cleanup_resident_number.sql` 별도 절차 대상 |
| 공개 anon 테이블 권한 | 3, 3-1 | 개인정보 테이블에 anon 권한 없어야 함 | 참고용 — RLS 적용 전이므로 아직 넓게 열려 있는 게 정상, 8번 이후 재확인 |

**차단 조건이 하나라도 해당하면 8번(마이그레이션 적용)으로 진행하지
말고, 아래 정리 계획만 세운다:**

- 중복 데이터(auth_user_id, case_caregivers, care_logs): 어느 행이
  "진짜"인지 업무적으로 판단 후 나머지를 비활성화(삭제 대신 status
  변경 등)하는 별도 SQL을 작성해 실행
- orphan 데이터: 참조하는 상위 행이 없는 이유를 먼저 조사(과거 마이그레이션
  누락 등), 필요시 상위 데이터 복구 또는 orphan 행 개별 정리
- admin_users 0건: 3~5번 단계를 먼저 완료

---

## 8. 나머지 마이그레이션 3개 적용 순서

7번 표에서 차단 조건이 없을 때만 진행한다. **한 파일씩** 적용하고 매번
검증한다.

1. `20260803120200_case_caregiver_functions.sql`
   - 실행 후 확인:
     ```sql
     select proname from pg_proc where proname = 'set_current_caregiver';
     select indexname from pg_indexes where indexname = 'uq_case_caregivers_one_current';
     ```
2. `20260803120400_registration_functions.sql`
   - 실행 후 확인:
     ```sql
     select proname from pg_proc where proname in ('register_case', 'join_case');
     ```
3. `20260803120500_rls_policies.sql`
   - 실행 후 확인은 9번(post_rls_verification)에서 종합적으로 진행.

어느 파일이든 에러가 나면 **즉시 중단**, 에러 메시지를 확보하고 원인을
해결한 뒤 그 파일부터 다시 시도한다(이미 성공한 앞 파일을 다시 실행할
필요는 없다 — `create or replace function`, `if not exists` 위주라
재실행해도 안전하지만, 굳이 반복하지 않는다).

---

## 9. post_rls_verification 확인표

`supabase/migrations/checks/post_rls_verification.sql`의 (A) 섹션(그냥
실행해도 안전한 진단 쿼리)을 먼저 전부 실행한다.

| 확인 항목 | 쿼리 | 기대 결과 |
| --- | --- | --- |
| 대상 테이블 RLS 활성 | A-1 | 8개 테이블 모두 `rls_enabled = true` |
| policy 목록 | A-2 | `20260803120500_rls_policies.sql`에 정의한 정책명이 전부 보임 |
| anon의 개인정보 테이블 권한 | A-3 (첫 쿼리) | 0 rows(caregivers/cases/case_caregivers/care_logs/care_log_photos/case_history에 anon 권한 없음) |
| anon의 hospitals 권한 | A-3 (두번째 쿼리) | `SELECT`만 존재 |
| 함수 execute 권한 | A-4 | `get_public_hospital`만 anon=true, 나머지는 anon=false / authenticated=true |
| get_public_hospital 반환 컬럼 | A-5 | `hospital_id, hospital_name, hospital_address, status`만(hospital_code/qr_token/hospital_phone 없음) |

(B) 섹션(특정 사용자 시점 흉내)은 `<CAREGIVER_USER_UUID>`,
`<ADMIN_USER_UUID>`, `<TEST_CASE_ID>`, `<OTHER_CASE_ID>` 등을 실제 값으로
치환해 하나씩 실행하고 매번 `rollback;`으로 끝나는지 확인한다(파일에
이미 `begin; ... rollback;`으로 감싸져 있음). 8개 시나리오(B-1~B-9) 결과를
아래처럼 기록한다:

| 시나리오 | 기대 결과 | 실제 결과 |
| --- | --- | --- |
| B-1 anon → caregivers | 0 rows | |
| B-2 anon → cases | 0 rows | |
| B-3 anon → get_public_hospital | 1건 반환 | |
| B-4 caregiver 본인 case 조회 | 1 row | |
| B-5 caregiver 타인 case 조회 | 0 rows | |
| B-6 비현재 간병인 insert | 에러(정책 위반) | |
| B-7 현재 간병인 insert | 성공(rollback으로 미반영) | |
| B-8 관리자 조회 | is_admin=true, 전체 조회 성공 | |
| B-9 anon → set_current_caregiver 호출 | permission denied 에러 | |

하나라도 기대와 다르면 10번(최종 승인)으로 진행하지 말고 원인을 먼저
해결한다.

---

## 10. main push 전 최종 승인 체크리스트

아래를 **모두** 확인해야 11번(push)으로 진행할 수 있다. 사람이 직접
체크한다 — AI가 대신 체크 표시하지 않는다.

- [ ] 7번 pre_rls_audit 차단 조건 전부 해소됨
- [ ] 8번 마이그레이션 3개(200/400/500) 전부 에러 없이 적용됨
- [ ] 9번 post_rls_verification (A), (B) 전부 기대 결과와 일치
- [ ] 1번 Vercel 환경변수 5개 모두 Production 스코프에 설정됨
- [ ] 2번 Supabase Email/Phone Auth 설정 완료(SMS 공급자 포함)
- [ ] 3~5번 관리자 최소 1명 이상 `admin_users` 등록 완료
- [ ] 6번 최소 1명 이상 테스트 caregiver `auth_user_id` 연결 완료
- [ ] `npm run lint`, `npm run build` 로컬에서 성공(이 문서 하단에서 재확인)
- [ ] 팀 내 최종 승인자 1명 이상이 위 항목을 함께 확인함(이름/직책은
      이 저장소에 기록하지 않음)

---

## 11. main push 명령

위 10번 체크리스트가 전부 완료된 뒤에만 실행한다. 아래 명령은 **이
문서에 기록만 하며, 지금 이 세션에서 실행하지 않는다.**

```bash
git checkout main
git status
git push origin main
```

(현재 로컬 `main`과 `staging`은 같은 커밋을 가리키고 있으므로 merge는
필요 없다. `git status`로 clean 상태를 다시 확인한 뒤 push한다.)

push 후 Vercel이 자동 배포를 시작하면, 배포 로그에서 빌드 성공 여부를
먼저 확인한다.

---

## 12. Vercel 배포 후 기능별 테스트 순서

배포가 끝난 뒤 실제 운영 URL에서 순서대로 확인한다.

1. **관리자**: 로그인 → 대시보드 통계 표시 → `/admin/cases` →
   `/admin/hospitals` → `/admin/cases/[id]/print` PDF 출력 → 로그아웃 →
   `/admin/login`으로 이동하는지 확인.
2. **간병인**: `/caregiver-login`에서 휴대폰 OTP 로그인 → `/my-cases`에서
   본인 사례만 보이는지 → 사례 상세 진입 → 현재 간병인이면 간병일지
   작성 가능, 아니면 차단 확인.
3. **병원 QR**: `/log?q=<실제 qr_token>` 접속 → 병원명만 보이고 환자
   목록이 없는지 → "최초 등록"/"간병인 로그인" 진입 확인.
4. **등록**: 비로그인 상태로 등록 폼 진입 시 휴대폰 인증 단계가 먼저
   나오는지 → 인증 후 등록 성공 → 동일 정보로 재등록 시 기존 사례
   안내 확인.
5. **간병일지**: 위치 허용 시 `checked`+좌표 저장, 거부 시 `unavailable`+
   사유 저장, 같은 날 재작성 시 오류 메시지, `case_history` 생성 확인.
6. **변경/종료**: 현재 간병인만 변경/종료 가능, 이력 기록 확인.
7. **Google Form sync**: 시크릿 없음/오류/정상 3가지 케이스 확인
   (`docs/staging-deployment-checklist.md` 20번 항목과 동일).

---

## 13. 장애 발생 시 rollback 절차

1. **증상 파악**: 관리자 접근 불가 / 간병인 전원 작성 불가 / 다른 사례
   노출 / anon으로 개인정보 조회 가능 / 등록·참여 원자성 실패 중 어느
   것에 해당하는지 먼저 특정한다.
2. **DB 롤백**: `supabase/migrations/rollback/20260803_rls_rollback.sql`을
   섹션별로 검토하며 실행한다(정책/함수만 제거, RLS는 켜진 채로 두는
   것이 기본값 — 이 상태에서는 anon/authenticated가 전면 차단되므로
   서비스가 정상화되지 않으면 파일 내 "완전 원복" 섹션(RLS 자체 비활성화)
   을 최후 수단으로 검토한다).
3. **코드 롤백**: Vercel Dashboard → Deployments → 직전 정상 배포를
   **Promote to Production**(또는 Instant Rollback 기능)으로 되돌린다.
   `git revert`로 커밋을 되돌리는 방법도 가능하나, 서비스 정상화가
   급하다면 Vercel의 배포 롤백이 더 빠르다.
4. **원인 조사**: staging 성격의 재현 환경이 없으므로, 문제를 안전하게
   재현하려면 별도 Supabase 프로젝트를 임시로 새로 만들어 이번 마이그레이션
   세트를 먼저 적용해보는 것을 권장한다(향후 이런 사고를 막기 위한
   근본 대책이기도 하다).
5. **재시도**: 원인 해결 후 7번(pre_rls_audit)부터 다시 진행한다.
