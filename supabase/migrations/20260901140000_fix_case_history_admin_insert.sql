-- ============================================================================
-- case_history: 관리자 INSERT 허용.
-- [운영 DB 상태 — 2026-09-01] 적용 완료.
--   적용 후 확인: WITH CHECK가
--   ((case_id IN (SELECT my_case_ids())) OR is_admin())로 반영됨,
--   case_history_select 무변경, RLS enabled 유지,
--   anon/authenticated GRANT는 INSERT/SELECT 그대로(확대 없음).
--   관리자 화면에서 간병일지 삭제 -> 복원을 실제 수행해 case_history에
--   CARE_LOG_DELETE / CARE_LOG_RESTORE 2행이 그 순서로 기록되는 것을
--   확인했다(수정 전에는 한 건도 남지 않았다).
-- ============================================================================
-- 증상: 관리자가 간병일지를 삭제하거나 복원할 때 남기려는 이력이 실제로는
-- 기록되지 않는다. 두 라우트 모두 이력 기록을 best-effort로 처리해
-- console.error만 남기므로(주 액션은 롤백하지 않는다는 기존 원칙), 화면에도
-- 아무 표시가 없어 지금까지 드러나지 않았다.
--
--   app/api/admin/care-logs/[id]/route.ts          (간병일지 삭제)
--   app/api/admin/care-logs/[id]/restore/route.ts  (간병일지 복원)
--
-- 원인: 20260803120500_rls_policies.sql의 case_history_insert 정책이
--
--   with check (case_id in (select my_case_ids()))
--
-- 뿐이고 is_admin() 조건이 없다. my_case_ids()는 current_caregiver_id()를
-- 거쳐 `caregivers.auth_user_id = auth.uid()`를 찾는데, 관리자는 caregivers
-- 행이 없으므로 항상 빈 집합이다. 따라서 조건이 거짓이 되어 INSERT가 RLS에
-- 막힌다. 같은 테이블의 SELECT 정책에는 `or is_admin()`이 있는데 INSERT
-- 정책에만 빠져 있었다.
--
-- *** 왜 여기서는 is_admin()이 올바른 해결책인가 ***
-- 직전 작업(20260901130000, reset_test_*)에서는 is_admin()을 쓰면 안 됐다.
-- 그 함수들은 service_role로 호출되어 auth.uid()가 null이기 때문이다.
-- 이번은 호출 구조가 반대다.
--
-- 관리자 삭제/복원 라우트는 requireAdminApi()가 돌려주는 supabase를 쓰고,
-- 그것은 lib/supabase-server.ts의 createServerClient — 즉 anon 키에 관리자
-- 로그인 쿠키가 바인딩된 SSR 클라이언트다(service_role이 아니다). 그래서
-- 이 요청은 관리자 본인의 JWT를 갖고 role=authenticated로 들어오며,
-- auth.uid()가 관리자 user_id를 정확히 가리킨다. is_admin()이 그대로
-- 동작하는 경로다.
--
-- 호출부마다 클라이언트가 다르다는 점이 핵심이다. 확인 결과:
--   service_role(RLS 우회, 정책 무관):
--     app/api/cases/register, app/api/cases/join,
--     app/api/cases/[id]/care-logs, .../[logId], .../current-caregiver,
--     .../end-care
--   authenticated 관리자 세션(RLS 적용 — 이번 대상):
--     app/api/admin/care-logs/[id], app/api/admin/care-logs/[id]/restore
--
-- *** 권한이 넓어지지 않는다 ***
-- 추가되는 조건은 is_admin()뿐이고, 그것은 admin_users에 등록된 사용자에게만
-- 참이다. anon은 auth.uid()가 null이라 여전히 거짓이고, 관리자가 아닌
-- authenticated 사용자도 마찬가지다. 기존 caregiver 조건은 손대지 않는다
-- (그 조건이 현재 인증 구조에서 사실상 동작하지 않는다는 별개의 문제는
--  2차 RLS 정리에서 다룬다 — 이번에 섞지 않는다).
--
-- 이 마이그레이션은 정책 하나만 바꾼다. RLS는 켜진 채로 두고, GRANT는
-- 건드리지 않으며(authenticated에는 이미 INSERT 권한이 있다 —
-- 20260803120500은 case_history에서 update/delete만 회수했다), 데이터도
-- 변경하지 않는다.
-- ============================================================================

-- 저장소 관례대로 drop 후 재생성한다(결과 정책 전문이 한눈에 보이도록).
-- DDL은 트랜잭션 안에서 처리되므로 정책이 사라진 순간은 없다.
drop policy if exists case_history_insert on case_history;

create policy case_history_insert on case_history
  for insert
  with check (
    case_id in (select my_case_ids())
    or is_admin()
  );


-- ----------------------------------------------------------------------------
-- 사후 검증
-- ----------------------------------------------------------------------------
do $$
declare
  v_check text;
begin
  select pg_get_expr(pol.polwithcheck, pol.polrelid)
    into v_check
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  where c.relname = 'case_history'
    and pol.polname = 'case_history_insert';

  if v_check is null then
    raise exception 'case_history_insert 정책이 없습니다.';
  end if;

  if v_check not like '%is_admin()%' then
    raise exception '관리자 조건이 반영되지 않았습니다: %', v_check;
  end if;

  if v_check not like '%my_case_ids()%' then
    raise exception '기존 조건이 사라졌습니다: %', v_check;
  end if;

  -- RLS가 켜진 상태로 남아 있어야 한다.
  if not exists (
    select 1 from pg_class
    where relname = 'case_history' and relrowsecurity
  ) then
    raise exception 'case_history의 RLS가 꺼져 있습니다.';
  end if;
end
$$;


-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- drop policy if exists case_history_insert on case_history;
-- create policy case_history_insert on case_history
--   for insert
--   with check (case_id in (select my_case_ids()));
--
-- 되돌리면 관리자 삭제/복원 이력이 다시 기록되지 않는 상태로 돌아간다.
