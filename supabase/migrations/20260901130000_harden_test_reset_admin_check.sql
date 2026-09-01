-- ============================================================================
-- reset_test_* 함수에 관리자 호출 검증 추가.
-- [운영 DB 상태 — 2026-09-01] 적용 완료.
--   적용 후 확인: 브라우저 역할(PUBLIC/anon/authenticated)의 EXECUTE 0행,
--   헬퍼 생성 확인, reset_test_* 5개 시그니처 적용 전과 동일,
--   관리자 화면에서 QA reset 실제 실행 성공(= service_role 경로가 검증을
--   통과함을 실측으로 확인).
-- ============================================================================
-- 배경: 2026-09-01 보안 감사에서 이 함수들이 anon EXECUTE를 갖고 있는 것이
-- 발견되어 20260901120000에서 실행 권한을 회수했다. 그 조치로 현재 도달
-- 경로는 막혀 있다. 이 마이그레이션은 남은 구조적 약점을 보강한다 —
-- 함수 자체는 여전히 호출자를 전혀 검증하지 않는다.
--
-- 권한 회수는 방어선 하나뿐이다. 누군가 실수로 EXECUTE를 다시 부여하거나,
-- 새 함수를 만들며 default privileges를 회수하지 않으면 곧바로 같은 상태로
-- 돌아간다. SECURITY DEFINER + 데이터 삭제 조합은 그 한 겹에 기대면 안 된다.
--
-- *** 왜 is_admin()만으로는 안 되는가 ***
-- 이 함수들은 app/api/admin/test-reset/execute/route.ts가
-- requireAdminApi()로 관리자를 확인한 뒤 createSupabaseAdminClient()
-- (service_role)로 호출한다. service_role 키는 사용자 JWT가 아니라 프로젝트
-- 키라서 sub 클레임이 없다. 따라서 그 요청에서 auth.uid()는 null이고
-- is_admin()은 항상 false다(운영에서 확인: anon 키로 current_caregiver_id()
-- 호출 시 null 반환 — 같은 이유다).
--
-- 즉 `if not is_admin() then raise` 를 넣으면 공격자가 아니라 정상 관리자
-- 기능이 막힌다. 실제 호출 구조에 맞는 검증이어야 한다.
--
-- *** 선택한 방식 ***
-- "이 요청이 service_role로 들어왔는가"를 본다. service_role 키는 서버
-- 환경변수에만 있고 브라우저로 나가지 않으므로, 그 역할로 들어왔다는 것은
-- 서버 라우트를 거쳤다는 뜻이다. 그 라우트는 반드시 requireAdminApi()를
-- 먼저 통과한다.
--
-- 함께 is_admin()도 허용한다 — 나중에 관리자 세션 클라이언트로 직접
-- 호출하도록 바꾸더라도 이 검증이 그대로 통한다. 지금은 authenticated에
-- EXECUTE가 없어 도달할 수 없는 경로지만, 조건을 열어 두어도 위험하지
-- 않다(진짜 관리자 JWT일 때만 참이다).
--
-- PostgREST를 거치지 않는 직접 연결(SQL Editor, psql)에는 request.jwt.claims
-- 자체가 없다. 이 경우는 운영자가 콘솔에서 직접 실행하는 상황이므로
-- 허용한다 — 막아도 우회가 아니라 운영만 불편해진다.
--
-- 브라우저가 조작할 수 있는 값(클라이언트가 넘긴 admin_id, boolean 플래그,
-- 하드코딩 시크릿)은 쓰지 않는다. 시그니처도 바꾸지 않는다.
--
-- *** 바꾸지 않는 것 ***
-- 시그니처, 반환 타입, 삭제 대상과 순서, search_path, SECURITY DEFINER,
-- EXECUTE 권한 상태. 함수 본문은 현재 운영에 적용된 정의를 그대로 옮기고
-- 최외곽 begin 바로 뒤에 검증 한 줄만 넣었다.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. 호출자 검증 헬퍼
-- ----------------------------------------------------------------------------
-- SECURITY INVOKER로 둔다(기본값) — 요청 컨텍스트(request.jwt.claims)를
-- 그대로 읽기만 하고, 권한이 필요한 조회는 is_admin()에 맡긴다.
create or replace function assert_test_reset_caller()
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  -- PostgREST가 요청마다 넣어 주는 클레임. 직접 DB 연결에는 없다(null).
  v_role := current_setting('request.jwt.claims', true)::jsonb ->> 'role';

  if v_role is null then
    -- PostgREST를 거치지 않은 직접 연결(SQL Editor/psql). 운영자 콘솔.
    return;
  end if;

  if v_role = 'service_role' then
    -- 서버 라우트 경로. 그 라우트는 requireAdminApi()를 먼저 통과한다.
    return;
  end if;

  if is_admin() then
    -- 관리자 Supabase Auth 세션으로 직접 호출한 경우(현재는 EXECUTE가
    -- 없어 도달 불가하지만, 향후 구조 변경을 위해 열어 둔다).
    return;
  end if;

  raise exception 'not_authorized_for_test_reset' using errcode = '42501';
end
$$;

comment on function assert_test_reset_caller() is
  'reset_test_* 함수의 호출자 검증. service_role 요청 또는 관리자 세션만 허용한다.';

-- 새 EXECUTE 권한을 만들지 않는다. 20260901120000이 정리한 상태를 그대로
-- 유지하기 위해, 이 헬퍼도 브라우저 역할에는 부여하지 않는다.
-- (reset_test_* 안에서 호출될 때는 그 함수의 SECURITY DEFINER 권한으로
--  실행되므로 별도 grant가 필요 없다.)
revoke all on function assert_test_reset_caller() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 1. reset_test_* 재정의 (검증 한 줄 추가 외에는 동일)
-- ----------------------------------------------------------------------------

create or replace function reset_test_case_data(p_case_id uuid)
returns table (
  deleted_cases integer,
  deleted_case_caregivers integer,
  deleted_care_logs integer,
  deleted_care_log_photos integer,
  deleted_consents integer,
  deleted_histories integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cases integer := 0;
  v_links integer := 0;
  v_logs integer := 0;
  v_photos integer := 0;
  v_consents integer := 0;
  v_histories integer := 0;
begin
  -- *** 관리자 호출 검증 — 데이터 변경보다 먼저 ***
  -- 이 함수들은 Next.js 서버 라우트가 requireAdminApi()로 관리자를 확인한
  -- 뒤 service_role로만 호출한다. service_role 키에는 sub 클레임이 없어
  -- auth.uid()가 null이고 is_admin()도 false이므로, is_admin()만으로
  -- 검사하면 정상 호출까지 막힌다. 자세한 근거는 이 마이그레이션 상단 참고.
  perform assert_test_reset_caller();

  if p_case_id is null then
    raise exception 'invalid_case_id' using errcode = '22023';
  end if;

  delete from care_log_photos
  where log_id in (select log_id from care_logs where case_id = p_case_id);
  get diagnostics v_photos = row_count;

  delete from care_logs where case_id = p_case_id;
  get diagnostics v_logs = row_count;

  -- 이 사례의 등록 건(initial/family_join 모두)을 case_consents보다 먼저
  -- 지운다. consent_id FK에 ON DELETE 옵션이 없어, 이 행이 남아 있으면
  -- 바로 다음 줄의 case_consents 삭제가 23503으로 실패한다.
  -- case_id로만 범위를 한정하므로 다른 사례의 등록 이력은 건드리지 않는다.
  -- 건수는 반환 타입을 유지하기 위해 집계하지 않는다(preview에서 보여준다).
  delete from caregiver_registrations where case_id = p_case_id;

  delete from case_consents where case_id = p_case_id;
  get diagnostics v_consents = row_count;

  -- 사례 자체가 사라지므로 그 사례의 이력도 함께 삭제한다.
  delete from case_history where case_id = p_case_id;
  get diagnostics v_histories = row_count;

  delete from case_caregivers where case_id = p_case_id;
  get diagnostics v_links = row_count;

  delete from cases where case_id = p_case_id;
  get diagnostics v_cases = row_count;

  return query select v_cases, v_links, v_logs, v_photos, v_consents, v_histories;
end;
$$;


create or replace function reset_test_caregiver_cleanup(
  p_caregiver_id uuid,
  p_revoke_sessions boolean default true
)
returns table (
  deleted_caregivers integer,
  deleted_sessions integer,
  deleted_otp_codes integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text;
  v_remaining_links integer := 0;
  v_caregivers integer := 0;
  v_sessions integer := 0;
  v_otp integer := 0;
begin
  -- *** 관리자 호출 검증 — 데이터 변경보다 먼저 ***
  -- 이 함수들은 Next.js 서버 라우트가 requireAdminApi()로 관리자를 확인한
  -- 뒤 service_role로만 호출한다. service_role 키에는 sub 클레임이 없어
  -- auth.uid()가 null이고 is_admin()도 false이므로, is_admin()만으로
  -- 검사하면 정상 호출까지 막힌다. 자세한 근거는 이 마이그레이션 상단 참고.
  perform assert_test_reset_caller();

  if p_caregiver_id is null then
    raise exception 'invalid_caregiver_id' using errcode = '22023';
  end if;

  select phone_normalized into v_phone
  from caregivers
  where caregiver_id = p_caregiver_id;

  if v_phone is null then
    return query select 0, 0, 0;
    return;
  end if;

  select count(*) into v_remaining_links
  from case_caregivers
  where caregiver_id = p_caregiver_id;

  -- OTP 레코드는 phone_normalized로만 연결되어 있다(FK 없음). 같은 번호로
  -- 처음부터 다시 테스트할 수 있어야 하므로, caregiver 삭제 여부와 무관하게
  -- 항상 정리한다(verified_at/consumed_at 등 인증 완료 흔적 포함).
  delete from caregiver_otp_codes where phone_normalized = v_phone;
  get diagnostics v_otp = row_count;

  if v_remaining_links = 0 then
    delete from caregiver_sessions where caregiver_id = p_caregiver_id;
    get diagnostics v_sessions = row_count;

    -- caregiver 행을 지우기 직전에만, 이 caregiver를 참조하는 등록 건 중
    -- 아직 남은 것을 정리한다(위 주석의 근거 참고). 이 분기는 어떤 사례에도
    -- 연결이 없는 caregiver에서만 실행되므로 다른 사례의 이력은 대상이 되지
    -- 않는다.
    delete from caregiver_registrations where caregiver_id = p_caregiver_id;

    delete from caregivers where caregiver_id = p_caregiver_id;
    get diagnostics v_caregivers = row_count;
  elsif p_revoke_sessions then
    -- caregiver는 유지하되(다른 사례에 연결됨) 세션만 제거해 재로그인부터
    -- 다시 테스트할 수 있게 한다. 등록 이력은 손대지 않는다.
    delete from caregiver_sessions where caregiver_id = p_caregiver_id;
    get diagnostics v_sessions = row_count;
  end if;

  return query select v_caregivers, v_sessions, v_otp;
end;
$$;


create or replace function reset_test_case(
  p_case_id uuid,
  p_revoke_sessions boolean default true
)
returns table (
  deleted_cases integer,
  deleted_case_caregivers integer,
  deleted_care_logs integer,
  deleted_care_log_photos integer,
  deleted_consents integer,
  deleted_histories integer,
  deleted_caregivers integer,
  deleted_sessions integer,
  deleted_otp_codes integer,
  deleted_hospitals integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caregiver_ids uuid[];
  v_caregiver_id uuid;
  v_case record;
  v_cleanup record;
  v_caregivers integer := 0;
  v_sessions integer := 0;
  v_otp integer := 0;
begin
  -- *** 관리자 호출 검증 — 데이터 변경보다 먼저 ***
  -- 이 함수들은 Next.js 서버 라우트가 requireAdminApi()로 관리자를 확인한
  -- 뒤 service_role로만 호출한다. service_role 키에는 sub 클레임이 없어
  -- auth.uid()가 null이고 is_admin()도 false이므로, is_admin()만으로
  -- 검사하면 정상 호출까지 막힌다. 자세한 근거는 이 마이그레이션 상단 참고.
  perform assert_test_reset_caller();

  if p_case_id is null then
    raise exception 'invalid_case_id' using errcode = '22023';
  end if;

  if not exists (select 1 from cases where case_id = p_case_id) then
    raise exception 'case_not_found' using errcode = '22023';
  end if;

  select array_agg(distinct caregiver_id) into v_caregiver_ids
  from case_caregivers
  where case_id = p_case_id;

  select * into v_case from reset_test_case_data(p_case_id);

  if v_caregiver_ids is not null then
    foreach v_caregiver_id in array v_caregiver_ids loop
      select * into v_cleanup
      from reset_test_caregiver_cleanup(v_caregiver_id, p_revoke_sessions);

      v_caregivers := v_caregivers + v_cleanup.deleted_caregivers;
      v_sessions := v_sessions + v_cleanup.deleted_sessions;
      v_otp := v_otp + v_cleanup.deleted_otp_codes;
    end loop;
  end if;

  return query select
    v_case.deleted_cases,
    v_case.deleted_case_caregivers,
    v_case.deleted_care_logs,
    v_case.deleted_care_log_photos,
    v_case.deleted_consents,
    v_case.deleted_histories,
    v_caregivers,
    v_sessions,
    v_otp,
    0;
end;
$$;


create or replace function reset_test_caregiver(
  p_caregiver_id uuid,
  p_case_ids uuid[],
  p_revoke_sessions boolean default true
)
returns table (
  deleted_cases integer,
  deleted_case_caregivers integer,
  deleted_care_logs integer,
  deleted_care_log_photos integer,
  deleted_consents integer,
  deleted_histories integer,
  deleted_caregivers integer,
  deleted_sessions integer,
  deleted_otp_codes integer,
  deleted_hospitals integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case_id uuid;
  v_case record;
  v_cleanup record;
  v_remaining_links integer := 0;
  v_tmp integer := 0;
  v_cases integer := 0;
  v_links integer := 0;
  v_logs integer := 0;
  v_photos integer := 0;
  v_consents integer := 0;
  v_histories integer := 0;
begin
  -- *** 관리자 호출 검증 — 데이터 변경보다 먼저 ***
  -- 이 함수들은 Next.js 서버 라우트가 requireAdminApi()로 관리자를 확인한
  -- 뒤 service_role로만 호출한다. service_role 키에는 sub 클레임이 없어
  -- auth.uid()가 null이고 is_admin()도 false이므로, is_admin()만으로
  -- 검사하면 정상 호출까지 막힌다. 자세한 근거는 이 마이그레이션 상단 참고.
  perform assert_test_reset_caller();

  if p_caregiver_id is null then
    raise exception 'invalid_caregiver_id' using errcode = '22023';
  end if;

  if not exists (select 1 from caregivers where caregiver_id = p_caregiver_id) then
    raise exception 'caregiver_not_found' using errcode = '22023';
  end if;

  if p_case_ids is not null then
    foreach v_case_id in array p_case_ids loop
      -- 안전장치: 이 caregiver와 연결되지 않은 사례는 초기화 대상이 될 수
      -- 없다(관리자가 다른 사례 id를 섞어 보내도 서버에서 차단).
      if not exists (
        select 1 from case_caregivers
        where case_id = v_case_id and caregiver_id = p_caregiver_id
      ) then
        raise exception 'case_not_linked_to_caregiver' using errcode = '22023';
      end if;

      delete from care_log_photos
      where log_id in (
        select log_id from care_logs
        where case_id = v_case_id and caregiver_id = p_caregiver_id
      );
      get diagnostics v_tmp = row_count;
      v_photos := v_photos + v_tmp;

      delete from care_logs
      where case_id = v_case_id and caregiver_id = p_caregiver_id;
      get diagnostics v_tmp = row_count;
      v_logs := v_logs + v_tmp;

      delete from case_consents
      where case_id = v_case_id and caregiver_id = p_caregiver_id;
      get diagnostics v_tmp = row_count;
      v_consents := v_consents + v_tmp;

      delete from case_caregivers
      where case_id = v_case_id and caregiver_id = p_caregiver_id;
      get diagnostics v_tmp = row_count;
      v_links := v_links + v_tmp;

      select count(*) into v_remaining_links
      from case_caregivers
      where case_id = v_case_id;

      if v_remaining_links = 0 then
        select * into v_case from reset_test_case_data(v_case_id);

        v_cases := v_cases + v_case.deleted_cases;
        v_links := v_links + v_case.deleted_case_caregivers;
        v_logs := v_logs + v_case.deleted_care_logs;
        v_photos := v_photos + v_case.deleted_care_log_photos;
        v_consents := v_consents + v_case.deleted_consents;
        v_histories := v_histories + v_case.deleted_histories;
      end if;
    end loop;
  end if;

  select * into v_cleanup
  from reset_test_caregiver_cleanup(p_caregiver_id, p_revoke_sessions);

  return query select
    v_cases,
    v_links,
    v_logs,
    v_photos,
    v_consents,
    v_histories,
    v_cleanup.deleted_caregivers,
    v_cleanup.deleted_sessions,
    v_cleanup.deleted_otp_codes,
    0;
end;
$$;


create or replace function reset_test_hospital(
  p_hospital_id uuid,
  p_delete_hospital boolean default false,
  p_revoke_sessions boolean default true
)
returns table (
  deleted_cases integer,
  deleted_case_caregivers integer,
  deleted_care_logs integer,
  deleted_care_log_photos integer,
  deleted_consents integer,
  deleted_histories integer,
  deleted_caregivers integer,
  deleted_sessions integer,
  deleted_otp_codes integer,
  deleted_hospitals integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case_id uuid;
  v_caregiver_id uuid;
  v_caregiver_ids uuid[];
  v_case record;
  v_cleanup record;
  v_cases integer := 0;
  v_links integer := 0;
  v_logs integer := 0;
  v_photos integer := 0;
  v_consents integer := 0;
  v_histories integer := 0;
  v_caregivers integer := 0;
  v_sessions integer := 0;
  v_otp integer := 0;
  v_hospitals integer := 0;
begin
  -- *** 관리자 호출 검증 — 데이터 변경보다 먼저 ***
  -- 이 함수들은 Next.js 서버 라우트가 requireAdminApi()로 관리자를 확인한
  -- 뒤 service_role로만 호출한다. service_role 키에는 sub 클레임이 없어
  -- auth.uid()가 null이고 is_admin()도 false이므로, is_admin()만으로
  -- 검사하면 정상 호출까지 막힌다. 자세한 근거는 이 마이그레이션 상단 참고.
  perform assert_test_reset_caller();

  if p_hospital_id is null then
    raise exception 'invalid_hospital_id' using errcode = '22023';
  end if;

  if not exists (select 1 from hospitals where hospital_id = p_hospital_id) then
    raise exception 'hospital_not_found' using errcode = '22023';
  end if;

  select array_agg(distinct cc.caregiver_id) into v_caregiver_ids
  from case_caregivers cc
  join cases c on c.case_id = cc.case_id
  where c.hospital_id = p_hospital_id;

  for v_case_id in
    select case_id from cases where hospital_id = p_hospital_id
  loop
    select * into v_case from reset_test_case_data(v_case_id);

    v_cases := v_cases + v_case.deleted_cases;
    v_links := v_links + v_case.deleted_case_caregivers;
    v_logs := v_logs + v_case.deleted_care_logs;
    v_photos := v_photos + v_case.deleted_care_log_photos;
    v_consents := v_consents + v_case.deleted_consents;
    v_histories := v_histories + v_case.deleted_histories;
  end loop;

  if v_caregiver_ids is not null then
    foreach v_caregiver_id in array v_caregiver_ids loop
      select * into v_cleanup
      from reset_test_caregiver_cleanup(v_caregiver_id, p_revoke_sessions);

      v_caregivers := v_caregivers + v_cleanup.deleted_caregivers;
      v_sessions := v_sessions + v_cleanup.deleted_sessions;
      v_otp := v_otp + v_cleanup.deleted_otp_codes;
    end loop;
  end if;

  if p_delete_hospital then
    delete from hospitals where hospital_id = p_hospital_id;
    get diagnostics v_hospitals = row_count;
  end if;

  return query select
    v_cases, v_links, v_logs, v_photos, v_consents, v_histories,
    v_caregivers, v_sessions, v_otp, v_hospitals;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. EXECUTE 권한 재확인
-- ----------------------------------------------------------------------------
-- CREATE OR REPLACE는 기존 권한을 유지하지만, 혹시라도 default privileges가
-- 다시 붙는 일이 없도록 20260901120000과 같은 상태를 다시 못박는다.
-- 새로 부여하는 것이 아니라 회수만 한다.
revoke all on function reset_test_case_data(uuid) from public, anon, authenticated;
revoke all on function reset_test_caregiver_cleanup(uuid, boolean) from public, anon, authenticated;
revoke all on function reset_test_case(uuid, boolean) from public, anon, authenticated;
revoke all on function reset_test_caregiver(uuid, uuid[], boolean) from public, anon, authenticated;
revoke all on function reset_test_hospital(uuid, boolean, boolean) from public, anon, authenticated;

do $$
declare
  v_left text;
begin
  select string_agg(distinct p.proname, ', ')
    into v_left
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(p.proacl) ac
  left join pg_roles r on r.oid = ac.grantee
  where n.nspname = 'public'
    and ac.privilege_type = 'EXECUTE'
    and coalesce(r.rolname, 'PUBLIC') in ('PUBLIC', 'anon', 'authenticated')
    and (p.proname like 'reset\_test\_%' or p.proname = 'assert_test_reset_caller');

  if v_left is not null then
    raise exception '초기화 함수에 브라우저 실행 권한이 남아 있습니다: %', v_left;
  end if;
end
$$;


-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- 되돌리려면 20260807090100_test_reset_functions.sql 과
-- 20260828093000_test_reset_caregiver_registrations.sql 의 함수 정의를 다시
-- 적용한 뒤 drop function assert_test_reset_caller(); 를 실행한다.
-- 되돌리기 전에 "어떤 정상 호출이 막혔는지"를 먼저 확인할 것 — 이 검증은
-- service_role 경로와 관리자 세션을 모두 허용한다.
