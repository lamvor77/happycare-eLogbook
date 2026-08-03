# RLS 롤아웃 절차

4단계(RLS 적용 전 서버 경계 전환)에서 앱 코드는 이미 인증 클라이언트/서버
API 경유 구조로 전환되었다. 5단계에서는 마이그레이션 순서를 감사하고,
적용 전/후 검증 SQL과 rollback SQL, smoke test 스크립트를 준비했다. 이
문서는 `supabase/migrations/`의 SQL을 실제 운영 DB에 적용하는 절차를
정리한다. **아래 SQL은 모두 자동 실행되지 않는다 — 매 단계 결과를
확인하며 수동으로 적용한다.**

## 0. 사전 변경 사항 요약 (이미 코드에 반영됨)

- `app/admin/**`: 전 경로가 `requireAdmin()`이 반환하는 인증 클라이언트
  사용(anon 싱글턴 미사용).
- 병원 등록/수정/QR 재발급: `app/api/admin/hospitals/**` (관리자 인증
  필요)로 전환.
- `app/log`: 병원의 전체 입원 환자 목록을 더 이상 보여주지 않는다(중요한
  UX 변경, 아래 "영향받는 UX" 참고).
- `app/case-register`, `app/case-join`: 휴대폰 OTP 인증 후에만 등록/참여
  폼을 진행할 수 있고, 실제 DB 반영은 `register_case()`/`join_case()`
  RPC를 통해서만 이뤄진다.
- `app/api/google-form-sync`: 시크릿 검증 통과 후 `service_role` 클라이언트
  사용.
- 신규 등록/참여에서는 주민등록번호 원문을 저장하지 않는다(마스킹만 저장).

## 5단계에서 바뀐 것 (마이그레이션 감사 결과)

- **파일명 순서 수정**: `20260803120300_rls_policies.sql`을
  `20260803120500_rls_policies.sql`로 재명명했다. 타임스탬프 순서상 300이
  400(registration_functions)보다 앞서 있어, 파일명 순서대로 적용하는
  도구를 쓰면 RPC가 준비되기 전에 RLS부터 켜지는 순서 오류가 있었다.
- `20260803120200_case_caregiver_functions.sql`에 "20260803120000이 먼저
  적용되어 있어야 한다"는 하드 의존성 주석을 추가했다(안 그러면 컬럼
  없음 오류로 CREATE FUNCTION 자체가 실패한다).
- RLS 정책 파일에 명시적 REVOKE(정책이 없는 명령에 대한 이중 방어),
  `hospitals_admin_write`를 FOR ALL에서 쓰기 전용으로 축소, storage 정책
  주석 정정(사진 업로드는 현재 어떤 신규 코드 경로에서도 구현되어 있지
  않음 — 레거시 `app/care-log/[id]/page.tsx`만 이 버킷을 쓰며, 그 페이지는
  이미 삭제된 `patients` 테이블을 참조하는 죽은 코드다) 등을 반영했다.
- 신규 파일: `supabase/migrations/checks/post_rls_verification.sql`,
  `supabase/migrations/rollback/20260803_rls_rollback.sql`,
  `scripts/rls-smoke-test.mjs`.

## 1. staging 백업

- staging 프로젝트의 DB 스냅샷을 받아둔다(Supabase Dashboard →
  Database → Backups, 또는 `pg_dump`).
- 최소한 `caregivers`, `cases`, `case_caregivers` 테이블은 별도로도
  백업해둔다(주민등록번호 원문 등 민감 데이터 포함 가능성 때문에 백업
  파일 자체의 접근 권한도 함께 관리할 것).

## 2. pre_rls_audit 실행

`supabase/migrations/checks/pre_rls_audit.sql`을 staging에서 실행하고
각 섹션 결과를 확인한다. 특히:

- 4번(중복 현재간병인)과 6번(case_no/family_code 누락)이 0건이어야
  이후 유니크 인덱스/제약 생성이 안전하다.
- 5번(auth_user_id 미연결 caregiver 수)이 크다면, 아래 "캐어기버 백필
  절차"를 먼저 진행한다.
- 5-1(auth_user_id 중복), 5-2(phone_normalized 중복), 8-1(중복 연결)이
  0건인지 확인한다.
- 9-3~9-6(위치 상태 이상값, 중복 작성 등)은 RLS 적용을 막지는 않지만
  기존 데이터 정합성 문제이므로 원인을 파악해둔다.
- 10번(admin_users 등록 수)은 이 시점에는 0일 수 있다(4번 단계에서
  등록) — 단, `20260803120050_admin_users.sql`이 먼저 적용되어 테이블이
  존재해야 이 쿼리가 에러 없이 실행된다.

## 3. auth_user_id 연결

`20260803120000_caregiver_auth_link.sql` 적용(`auth_user_id`,
`phone_normalized`, `resident_number_masked` 컬럼 추가) 후, 아래 "캐어기버
백필 절차"를 진행한다.

### 캐어기버(caregiver) 백필 절차

기존 caregiver는 Supabase Auth 사용자와 연결된 적이 없으므로
`auth_user_id`가 전부 NULL이다. **이 연결 전에는 해당 caregiver는 새
휴대폰 OTP 로그인 방식으로 로그인할 수 없다** — 반드시 순서대로 진행한다.

1. **휴대폰번호 정규화**: `caregivers.phone`의 실제 저장 형식을 확인하고
   (`010-1234-5678`, `01012345678` 등 혼재 가능), `phone_normalized`를
   E.164(`+8210...`)로 채운다. 백필 SQL 예시는
   `20260803120000_caregiver_auth_link.sql` 내 주석 참고. **먼저 SELECT로
   변환 결과를 확인한 뒤에만 UPDATE를 실행한다.**
2. **Supabase Auth 사용자 준비**: 아래 둘 중 하나를 선택한다.
   - (A) 관리자가 Dashboard(Authentication → Users → Add user → Phone)에서
     선제적으로 계정을 만든다.
   - (B) 별도로 계정을 만들지 않고, 해당 간병인이 `/caregiver-login`에서
     처음 로그인을 시도할 때 자동으로 계정이 생성되길 기다린다 — 단,
     `app/caregiver-login/page.tsx`는 `shouldCreateUser: false`로
     호출하므로 **(B) 방식은 그대로는 동작하지 않는다.** 기존 caregiver를
     로그인 가능하게 하려면 반드시 (A)로 Auth 계정을 먼저 만들어야 한다.
3. **auth_user_id 연결**: 아래 템플릿으로 연결한다(실제 UUID는 절대 이
   파일이나 커밋에 남기지 않는다 — SQL Editor에서 그때그때 치환해 실행).

   ```sql
   -- 1건씩 연결(가장 안전, 소규모용)
   update caregivers
   set auth_user_id = '<auth.users.id>'
   where caregiver_id = '<caregivers.caregiver_id>'
     and auth_user_id is null;
   ```

   대량 백필이 필요하면, `auth.users.phone`과 `caregivers.phone_normalized`
   가 일치하는 행을 자동으로 연결하는 아래 템플릿을 검토한다(실행 전
   반드시 SELECT로 매칭 결과를 먼저 확인할 것 — 전화번호 오탈자/중복이
   있으면 잘못된 사용자와 연결될 위험이 있다):

   ```sql
   -- 매칭 결과 미리 확인(아무것도 변경하지 않음)
   select cg.caregiver_id, cg.phone_normalized, au.id as would_link_auth_user_id
   from caregivers cg
   join auth.users au on au.phone = cg.phone_normalized
   where cg.auth_user_id is null;

   -- 위 결과가 caregiver 1건당 auth 사용자 1건으로만 매칭되는지 확인한 뒤:
   update caregivers cg
   set auth_user_id = au.id
   from auth.users au
   where au.phone = cg.phone_normalized
     and cg.auth_user_id is null;
   ```

4. **중복 번호 처리**: 여러 caregiver 행이 같은 `phone_normalized`를
   가지고 있다면(pre_rls_audit 5-2번 결과), 위 자동 매칭 쿼리가 어느
   행에 연결할지 예측할 수 없다. 이런 행은 자동 매칭 대상에서 제외하고
   (`where`절에 제외 조건 추가), 어느 행이 실제 살아있는 caregiver인지
   업무적으로 판단한 뒤 1건씩 수동으로 연결한다. 중복 행 중 실제로
   사용되지 않는 것은 삭제하지 말고 우선 그대로 두되(연결만 보류),
   후속 데이터 정리 과제로 남긴다.
5. **연결 확인**: `pre_rls_audit.sql` 5번 쿼리를 다시 실행해
   `caregivers_without_auth_user`가 예상 범위로 줄었는지 확인한다.
6. 신규 가입자(RLS 적용 이후 `case-register`/`case-join`으로 들어오는
   사람)는 이 수동 절차가 필요 없다 — `register_case()`/`join_case()`가
   최초 등록 시점에 자동으로 `auth_user_id`를 연결한다.

## 4. admin_users 등록 — 관리자 Bootstrap 절차

> **⚠️ 경고: 아래 순서를 지키지 않고 RLS(`20260803120500_rls_policies.sql`)
> 부터 적용하면, admin_users에 아무도 등록되지 않은 상태이므로 관리자
> 본인도 `/admin/**`에서 데이터를 전혀 볼 수 없게 된다.** `ADMIN_EMAILS`
> 환경변수만으로는 DB RLS의 `is_admin()` 검사를 통과할 수 없다 —
> 애플리케이션 레벨 인가(`ADMIN_EMAILS`)와 DB 레벨 인가(`admin_users`)는
> 서로 다른 메커니즘이며 **둘 다** 통과해야 한다.

정확한 순서:

1. **관리자 Supabase Auth 사용자 생성**: Dashboard → Authentication →
   Users에서 관리자 이메일로 계정을 생성(또는 기존 계정 확인)한다.
2. **`20260803120050_admin_users.sql` 적용** 후, 해당 `auth.users.id`를
   `admin_users`에 insert한다.

   ```sql
   insert into admin_users (user_id, email)
   values ('<auth.users.id>', '<관리자 이메일>');
   ```

3. **`ADMIN_EMAILS`와 `admin_users` 일치 확인**: 배포 환경변수
   `ADMIN_EMAILS`에 나열된 이메일 목록과 `admin_users`에 등록된 이메일이
   서로 빠짐없이 대응하는지 확인한다(`select email from admin_users;`로
   조회 후 육안 대조 — 실제 이메일을 로그나 커밋에 남기지 말 것).
4. **관리자 로그인 성공 확인**: RLS를 켜기 **전** 상태에서
   `/admin/login`으로 로그인해 `/admin`이 정상적으로 데이터를 보여주는지
   확인한다(이 시점엔 아직 RLS가 없으므로 anon 경로든 인증 경로든 둘 다
   동작해야 정상).
5. **RLS 적용**: 아래 7번 섹션 순서대로 `20260803120500_rls_policies.sql`
   까지 적용한다.
6. **관리자 페이지 재확인**: RLS 적용 **직후** 같은 관리자 계정으로 다시
   `/admin`, `/admin/cases`, `/admin/hospitals`,
   `/admin/cases/[id]/print`, `/admin/location-unavailable`에 접근해
   데이터가 여전히 보이는지 확인한다. 여기서 실패하면 즉시 2번(admin_users
   등록)부터 다시 점검한다.

## 5. 서버 환경변수 설정

배포 환경(Vercel 등)에 아래 서버 전용 환경변수가 설정되어 있는지 확인한다
(`NEXT_PUBLIC_` 접두사 금지, 브라우저에 노출되지 않아야 함):

- `ADMIN_EMAILS`
- `GOOGLE_FORM_SYNC_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`

## 6. 공개/등록/API 코드 배포

4단계에서 작성한 코드(관리자 인증 클라이언트 전환, 공개 조회 API,
등록/참여 서버 API, service_role 분리)를 먼저 배포하고, RLS 적용 전
상태에서도 정상 동작하는지 확인한다(이 코드들은 RLS가 꺼져 있어도 그대로
동작하도록 작성되었다).

## 7. RLS 적용

다음 순서로 적용한다(각 파일 적용 후 바로 다음 섹션의 smoke test 일부를
실행해보는 것을 권장). **파일명 숫자 순서 그대로 적용하면 된다** —
5단계에서 순서와 파일명이 일치하도록 재정리했다:

1. `20260803120000_caregiver_auth_link.sql` (3단계에서 이미 적용했다면 생략)
2. `20260803120050_admin_users.sql`
3. `20260803120200_case_caregiver_functions.sql` (3단계에서 이미 적용했다면 생략)
4. `20260803120400_registration_functions.sql`
5. `20260803120500_rls_policies.sql`

각 파일 적용 직후 `supabase/migrations/checks/post_rls_verification.sql`의
해당 섹션을 실행해 즉시 확인하는 것을 권장한다(전체는 5번 파일 적용 후
한 번에 실행해도 된다).

## 8. 기능별 smoke test

### 8-1. 수동 체크리스트

- [ ] 관리자 계정으로 `/admin`, `/admin/cases`, `/admin/hospitals`,
      `/admin/cases/[id]/print`, `/admin/location-unavailable` 접근 —
      데이터가 정상적으로 보이는가(가장 중요 — admin_users 미등록 시
      여기서 실패한다)
- [ ] 관리자 계정으로 병원 등록/수정/QR 재발급이 되는가
- [ ] 병원 QR(`/log?q=...`)이 병원명/주소만 보여주고 환자 목록을
      더 이상 보여주지 않는가
- [ ] `/case-register`에서 휴대폰 인증 → 폼 작성 → 등록이 되는가
      (SMS 공급자 설정 필요, `docs/caregiver-auth.md` 참고)
- [ ] `/case-join`에서 가족코드로 참여가 되는가
- [ ] 로그인한 간병인이 `/my-cases`에서 본인 사례만 보이는가
- [ ] 현재 간병인 계정으로 간병일지 작성/현재간병인 변경/간병종료가
      되는가
- [ ] 현재 간병인이 아닌 계정으로는 위 세 가지가 모두 거부되는가
- [ ] `google-form-sync`가 시크릿 헤더로 정상 동작하는가(service_role
      사용 확인)
- [ ] 브라우저 개발자도구 Network 탭에서 `caregivers.resident_number`
      원문이 어떤 응답에도 포함되지 않는지 확인
- [ ] `npm run build` 성공

### 8-2. 자동화된 smoke test 스크립트

`scripts/rls-smoke-test.mjs`가 위 체크리스트 중 API/DB 레벨로 확인
가능한 8개 항목을 자동으로 실행한다(브라우저 UI 확인은 여전히 수동으로
진행). **staging 전용** — 운영 프로젝트 값으로 실행하지 않는다.

사용법:

1. 커밋하지 않는 로컬 파일 `.env.rls-smoke-test`를 만들고(이미
   `.gitignore`의 `.env*` 패턴에 걸려 커밋되지 않는다) 아래 변수를
   채운다(실제 값은 이 문서/저장소 어디에도 적지 않는다):

   ```
   SUPABASE_URL=
   SUPABASE_ANON_KEY=
   CAREGIVER_ACCESS_TOKEN=
   NON_CURRENT_CAREGIVER_TOKEN=
   ADMIN_ACCESS_TOKEN=
   TEST_CASE_ID=
   TEST_QR_TOKEN=
   OTHER_CASE_ID=
   ```

   각 access_token은 해당 테스트 계정으로 앱에 실제 로그인한 뒤
   `supabase.auth.getSession()` 또는 브라우저 개발자도구의 Supabase 세션
   저장소에서 확인한다. 토큰은 비밀값에 준하게 다룰 것(셸 히스토리, CI
   로그에 남기지 않기).

2. 실행:

   ```bash
   npm run rls:smoke
   ```

3. 7번 테스트(현재 간병인 insert 성공)는 기본적으로 dry-run 설명만
   출력하고 실제로 실행하지 않는다. `care_logs`에는 delete 정책이 없어
   (감사 로그 성격) 한 번 생성한 테스트 행을 되돌릴 수 없기 때문이다.
   정말 실행하려면 `RUN_WRITE_TEST=1`을 추가로 설정한다:

   ```bash
   RUN_WRITE_TEST=1 npm run rls:smoke
   ```

## 9. rollback 절차

`supabase/migrations/rollback/20260803_rls_rollback.sql`에 아래 순서가
하나의 파일로 정리되어 있다(각 섹션을 개별적으로 검토하며 실행할 것):

1. `20260803120500_rls_policies.sql`의 정책/함수 제거(RLS는 켜진 채로
   둠 — 이 상태에서는 anon/authenticated가 전면 차단됨)
2. `20260803120400_registration_functions.sql`의 함수 제거(등록/참여
   기능도 함께 되돌리는 경우에만)
3. `20260803120200_case_caregiver_functions.sql`의 함수 제거(현재간병인
   변경 기능도 함께 되돌리는 경우에만)
4. (최후 수단) RLS 자체를 비활성화하는 "완전 원복" 섹션 — 실행하면 RLS
   적용 이전과 동일하게 anon key로 전체 접근 가능해지므로 정말 필요할
   때만 실행
5. 애플리케이션 코드는 이전 배포로 되돌린다(Vercel의 이전 배포로 롤백)
6. 문제 원인을 staging에서 재현/수정한 뒤 다시 2번(pre_rls_audit)부터
   진행한다

`admin_users` 테이블, `caregivers.auth_user_id`/`phone_normalized`/
`resident_number_masked` 컬럼과 그 안의 데이터는 이 rollback 스크립트가
기본적으로 삭제하지 않는다.

## 영향받는 UX 변경 (사용자에게 안내 필요)

- **QR 스캔 후 환자 목록 비공개**: 기존에는 `/log`에서 QR만 스캔하면
  병원의 모든 입원 환자명을 볼 수 있었다. 이제는 병원 정보만 보여주고,
  본인 사례를 보려면 반드시 간병인 로그인이 필요하다. 등록된 간병인이
  "내가 어떤 환자와 연결되어 있었는지 몰라서" QR 목록에 의존하던 경우
  혼란이 있을 수 있으므로, 안내문구/공지가 필요하다.
- **최초 등록/참여에 휴대폰 인증 필수**: 기존에는 폼만 작성하면 바로
  등록되었지만, 이제는 휴대폰 인증코드 입력 단계가 먼저 온다. SMS
  공급자가 아직 설정되지 않았다면 이 단계에서 막히므로, 운영 전환
  일정과 SMS 공급자 설정 일정을 맞춰야 한다.
- **주민등록번호 입력 축소**: 전체 13자리 대신 앞 7자리만 입력받는다
  (선택 입력). 기존에 전체 번호가 필요했던 업무 프로세스가 있다면
  사전에 확인이 필요하다.
