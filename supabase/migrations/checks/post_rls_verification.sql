-- ============================================================================
-- RLS 적용 후 검증 스크립트 — staging에서 20260803120500_rls_policies.sql
-- 적용 직후 실행할 것. 운영 DB에 자동 실행하지 않는다.
-- ============================================================================
--
-- 이 파일의 쿼리는 두 종류다:
--   (A) 그냥 실행해도 안전한 진단 쿼리(권한/정책 목록 조회)
--   (B) 특정 로그인 사용자 시점을 흉내내야 하는 쿼리 — Supabase Postgres에서
--       `request.jwt.claim.sub`를 세션 설정으로 넣고 role을 authenticated로
--       바꾸면 auth.uid()가 그 값을 반환하도록 흉내낼 수 있다. (B) 종류는
--       실제 UUID로 치환해야 하며, 부작용을 피하기 위해 매 블록을
--       `begin; ... rollback;` 으로 감쌌다. INSERT 성격 테스트는 실제로
--       한 행을 만들었다가 rollback으로 되돌리는 방식이라 커밋만 안 하면
--       데이터에 남지 않는다 — 그래도 staging에서만 실행할 것.
--
-- 아래 <ADMIN_USER_UUID>, <CAREGIVER_USER_UUID>, <OTHER_CASE_ID> 등은 실제
-- 값으로 치환해야 하는 placeholder다. 이 파일 자체에는 실제 UUID를 넣지
-- 않는다.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- (A-1) 대상 테이블 전부 RLS 활성 상태인지
-- ----------------------------------------------------------------------------
select tablename, rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
  and tablename in (
    'hospitals', 'cases', 'caregivers', 'case_caregivers',
    'care_logs', 'care_log_photos', 'case_history', 'admin_users'
  )
order by tablename;
-- 기대: 8개 행 모두 rls_enabled = true


-- ----------------------------------------------------------------------------
-- (A-2) 활성 policy 전체 목록(정책명, 명령, 대상 role)
-- ----------------------------------------------------------------------------
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
order by tablename, policyname;


-- ----------------------------------------------------------------------------
-- (A-3) anon이 개인정보 테이블에 select/insert/update/delete 권한이 전혀
-- 없는지 (hospitals의 select만 예외적으로 허용되어야 함)
-- ----------------------------------------------------------------------------
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee = 'anon'
  and table_name in (
    'caregivers', 'cases', 'case_caregivers',
    'care_logs', 'care_log_photos', 'case_history'
  );
-- 기대: 빈 결과(0 rows)

select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee = 'anon'
  and table_name = 'hospitals';
-- 기대: privilege_type = 'SELECT' 한 종류만


-- ----------------------------------------------------------------------------
-- (A-4) 함수 execute 권한 점검 — public에는 전혀 없어야 하고, anon은
-- get_public_hospital()만 실행 가능해야 한다.
-- ----------------------------------------------------------------------------
select
  p.proname as function_name,
  r.rolname as grantee,
  has_function_privilege(r.oid, p.oid, 'EXECUTE') as can_execute
from pg_proc p
cross join pg_roles r
where p.pronamespace = 'public'::regnamespace
  and p.proname in (
    'is_admin', 'current_caregiver_id', 'my_case_ids', 'get_public_hospital',
    'set_current_caregiver', 'register_case', 'join_case'
  )
  and r.rolname in ('anon', 'authenticated', 'public')
order by function_name, grantee;
-- 기대:
--   get_public_hospital: anon=true, authenticated=true
--   나머지 전부: anon=false, authenticated=true
--   'public'(의사 역할, PUBLIC 권한을 상속받는 모든 롤의 기준)은 전부 false


-- ----------------------------------------------------------------------------
-- (A-5) get_public_hospital()이 최소 컬럼만 반환하는지 — 반환 타입 자체가
-- 컬럼을 제한하므로, 함수 시그니처만 봐도 확인 가능하다.
-- ----------------------------------------------------------------------------
select pg_get_function_result('get_public_hospital(text, text)'::regprocedure);
-- 기대: "TABLE(hospital_id uuid, hospital_name text, hospital_address text, status text)"
--       (hospital_code, hospital_phone, qr_token이 포함되어 있지 않아야 함)

-- 실제 활성 병원 하나로 직접 호출해 결과 컬럼도 눈으로 확인(운영 데이터를
-- 출력하므로 staging에서만):
-- select * from get_public_hospital(p_qr_token := '<실제 활성 병원의 qr_token>');


-- ============================================================================
-- (B) 특정 사용자 시점 흉내 — 아래는 각 블록을 개별 실행하고 매번 rollback한다
-- ============================================================================

-- (B-1) anon 역할로 caregivers 조회 시도 → 실패(0 rows, 에러는 아님 — RLS는
-- "안 보임"으로 동작하지 permission denied 에러를 던지지 않는 것이 정상)
begin;
  set local role anon;
  select count(*) as visible_rows from caregivers;
  -- 기대: visible_rows = 0
rollback;

-- (B-2) anon 역할로 cases 전체 조회 시도 → 실패(0 rows)
begin;
  set local role anon;
  select count(*) as visible_rows from cases;
  -- 기대: visible_rows = 0
rollback;

-- (B-3) anon으로 get_public_hospital()은 성공해야 함(공개 조회 전용 경로)
begin;
  set local role anon;
  -- select * from get_public_hospital(p_qr_token := '<실제 활성 병원 qr_token>');
  -- 기대: 병원 1건 반환(hospital_id, hospital_name, hospital_address, status만)
rollback;

-- (B-4) 특정 caregiver 본인 시점: 본인이 연결된 case만 보이는지
-- <CAREGIVER_USER_UUID>는 caregivers.auth_user_id 값(auth.users.id)으로 치환.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', '<CAREGIVER_USER_UUID>', true);
  select auth.uid(); -- <CAREGIVER_USER_UUID>와 일치해야 함
  select case_id, case_no, patient_name from cases;
  -- 기대: 이 caregiver가 case_caregivers로 연결된 case만 나열됨
rollback;

-- (B-5) 위와 동일 사용자로, 자신과 무관한 다른 case_id를 직접 조회 → 실패
-- <OTHER_CASE_ID>는 이 caregiver와 연결되지 않은 case_id로 치환.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', '<CAREGIVER_USER_UUID>', true);
  select * from cases where case_id = '<OTHER_CASE_ID>';
  -- 기대: 0 rows
rollback;

-- (B-6) 현재 간병인이 아닌 caregiver로 care_logs insert 시도 → 실패
-- <NON_CURRENT_CAREGIVER_UUID>는 어떤 case의 case_caregivers에 연결되어
-- 있지만 is_current_caregiver=false인 caregiver의 auth_user_id.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', '<NON_CURRENT_CAREGIVER_UUID>', true);
  -- insert into care_logs (case_id, caregiver_id, care_date, location_status, location_checked_at)
  -- values ('<TEST_CASE_ID>', current_caregiver_id(), current_date, 'unavailable', now());
  -- 기대: "new row violates row-level security policy" 에러
rollback;

-- (B-7) 현재 간병인 본인으로 care_logs insert 시도 → 성공(반드시 rollback
-- 하므로 실제 데이터에는 남지 않음). care_date 유니크 제약과 겹치지 않도록
-- 오늘 이미 작성된 기록이 없는 case를 골라서 테스트할 것.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', '<CURRENT_CAREGIVER_UUID>', true);
  -- insert into care_logs (case_id, caregiver_id, care_date, location_status, location_checked_at)
  -- values ('<TEST_CASE_ID>', current_caregiver_id(), current_date, 'unavailable', now())
  -- returning log_id;
  -- 기대: 정상적으로 1 row insert(에러 없음)
rollback;

-- (B-8) 관리자 계정으로 caregivers/cases 전체 조회 → 성공
-- <ADMIN_USER_UUID>는 admin_users.user_id 값으로 치환.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', '<ADMIN_USER_UUID>', true);
  select is_admin(); -- true 여야 함
  select count(*) from caregivers;
  select count(*) from cases;
  -- 기대: is_admin() = true, 두 count 모두 anon/일반 caregiver보다 큰 전체 건수
rollback;

-- (B-9) set_current_caregiver / register_case / join_case 권한 확인
-- (실제 인자 없이 시그니처만 조회 — 앞의 (A-4)에서 이미 authenticated=true,
-- anon=false로 확인됨. 여기서는 anon으로 직접 호출 시 permission denied가
-- 나는지 실제로 실행해서 재확인한다.)
begin;
  set local role anon;
  -- select set_current_caregiver('<TEST_CASE_ID>'::uuid, '<ANY_CASE_CAREGIVER_ID>'::uuid);
  -- 기대: "permission denied for function set_current_caregiver" 에러
rollback;
