-- ============================================================================
-- admin_users 테이블 + is_admin() 헬퍼 (RLS 정책보다 먼저 적용)
-- ============================================================================
-- 운영 DB에 자동 실행되지 않는다. 이 파일은 20260803120500_rls_policies.sql
-- 보다 먼저 적용해야 한다 — docs/rls-rollout.md의 순서(4. admin_users 등록)가
-- 이 테이블의 존재를 전제로 하고, supabase/migrations/checks/
-- pre_rls_audit.sql도 이 테이블을 조회하기 때문이다.
--
-- 이행 계획:
--   1단계(기존): ADMIN_EMAILS 환경변수 + lib/admin-auth.ts로 앱 레벨 인가.
--   2단계(이 테이블): admin_users에 관리자 auth.users.id를 등록하고, DB RLS는
--     이 테이블 기준으로 판단한다. ADMIN_EMAILS는 계속 유지하여 이중 확인.
--   3단계(후속 과제): 소스를 admin_users로 일원화, ADMIN_EMAILS는 폐기/백업.
create table if not exists admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

alter table admin_users enable row level security;

drop policy if exists admin_users_self_select on admin_users;
create policy admin_users_self_select on admin_users
  for select
  using (user_id = auth.uid());

-- insert/update/delete 정책 없음(기본 거부). 등록은 Supabase Dashboard의
-- SQL Editor에서 관리자가 직접 수행하거나 service_role 스크립트로만 한다.
-- 예시(실제 값으로 치환 후 실행):
--   insert into admin_users (user_id, email)
--   values ('<auth.users.id>', '<관리자 이메일>');

create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from admin_users where user_id = auth.uid()
  );
$$;

revoke all on function is_admin() from public;
grant execute on function is_admin() to authenticated;

-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- drop function if exists is_admin();
-- drop policy if exists admin_users_self_select on admin_users;
-- drop table if exists admin_users;
