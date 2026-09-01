-- ============================================================================
-- 보안 정리 1차 — 적용 전/후 확인용 읽기 전용 쿼리.
-- ============================================================================
-- 전부 SELECT다. 데이터나 권한을 바꾸지 않는다. 적용 전에 한 번,
-- 적용 후에 한 번 실행해 결과를 비교하면 마이그레이션이 의도한 것만
-- 바꿨는지 확인할 수 있다.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) 구형 v1 RPC의 실행 권한
-- ----------------------------------------------------------------------------
-- 적용 후 기대: anon / authenticated / PUBLIC 이 목록에 없어야 한다.
--               postgres / service_role 은 남아 있어도 된다.
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args,
  coalesce(
    array_agg(distinct coalesce(r.rolname, 'PUBLIC')) filter (where ac.privilege_type = 'EXECUTE'),
    '{}'
  ) as execute_granted_to
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join lateral aclexplode(p.proacl) ac on true
left join pg_roles r on r.oid = ac.grantee
where n.nspname = 'public'
  and p.proname in (
    'register_case', 'join_case', 'set_current_caregiver',
    'register_case_v3', 'join_case_v3', 'set_current_caregiver_v2',
    'get_public_hospital', 'get_public_hospital_v2'
  )
group by p.proname, p.oid
order by p.proname;


-- ----------------------------------------------------------------------------
-- 1-b) 마이그레이션에 적은 시그니처가 실제 함수와 일치하는지
-- ----------------------------------------------------------------------------
-- to_regprocedure()는 그 시그니처로 실제 함수를 찾을 수 있을 때만 값을
-- 돌려주고, 못 찾으면 null이다. 1)의 결과는 인자 이름까지 들어가 길어서
-- 화면에서 잘리기 쉬운데, 이 쿼리는 "일치/불일치"만 짧게 답한다.
-- 셋 다 null이 아니어야 한다.
select
  to_regprocedure('public.register_case(uuid, text, date, text, text, text, text, text, text, text, text, text, text, date, date, text, boolean, text, text, text)') is not null as register_case_ok,
  to_regprocedure('public.join_case(text, text, text, text, text)') is not null as join_case_ok,
  to_regprocedure('public.set_current_caregiver(uuid, uuid)') is not null as set_current_caregiver_ok;

-- 같은 이름의 오버로드가 더 있는지(각 이름당 1이어야 한다).
select p.proname, count(*) as overloads
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('register_case', 'join_case', 'set_current_caregiver')
group by p.proname
order by p.proname;


-- ----------------------------------------------------------------------------
-- 2) 브라우저 역할의 테이블 권한
-- ----------------------------------------------------------------------------
-- 적용 후 기대:
--   - TRUNCATE / TRIGGER / REFERENCES 가 한 줄도 없어야 한다.
--   - audit_logs / patient_members / patients / qr_auth_logs / users 가
--     결과에서 사라져야 한다(권한 전무).
select
  table_name,
  grantee,
  string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
group by table_name, grantee
order by table_name, grantee;


-- ----------------------------------------------------------------------------
-- 3) hospitals의 컬럼 단위 SELECT 권한
-- ----------------------------------------------------------------------------
-- 적용 후 기대(20260901100000까지 적용한 경우):
--   anon          -> hospital_id, hospital_name, hospital_address, status 만
--   authenticated -> 관리자 화면용으로 기존 컬럼 유지
select grantee, column_name
from information_schema.column_privileges
where table_schema = 'public'
  and table_name = 'hospitals'
  and privilege_type = 'SELECT'
  and grantee in ('anon', 'authenticated')
order by grantee, column_name;


-- ----------------------------------------------------------------------------
-- 4) RLS 활성 상태
-- ----------------------------------------------------------------------------
-- 이번 마이그레이션은 RLS를 건드리지 않는다. 적용 전후 결과가 같아야 한다.
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;


-- ----------------------------------------------------------------------------
-- 5) 레거시 테이블에 실제로 데이터가 있는지
-- ----------------------------------------------------------------------------
-- 2026-09-01 확인 시점에는 5개 모두 0행이었다. 0행이 아니라면 정말
-- 미사용인지 다시 확인한 뒤에 후속 정리(테이블 제거 등)를 판단한다.
-- 건수만 센다 — 내용은 조회하지 않는다.
select 'audit_logs' as t, count(*) from audit_logs
union all select 'patient_members', count(*) from patient_members
union all select 'patients', count(*) from patients
union all select 'qr_auth_logs', count(*) from qr_auth_logs
union all select 'users', count(*) from users;


-- ----------------------------------------------------------------------------
-- 6) 관리자 권한 출처 대조
-- ----------------------------------------------------------------------------
-- 애플리케이션은 ADMIN_EMAILS 환경변수로, DB의 is_admin()은 admin_users
-- 테이블로 관리자를 판단한다. 두 목록이 어긋나면 "화면은 통과하는데 조회
-- 결과가 0건"이 된다. 건수와 이메일 도메인만 확인한다.
select count(*) as admin_users_count from admin_users;
