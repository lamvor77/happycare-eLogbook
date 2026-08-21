-- ============================================================================
-- 테스트/QA 전용 데이터 초기화 RPC — 운영 DB에 자동 실행하지 않는다.
-- ============================================================================
-- *** 이 파일은 운영 데이터 관리 기능이 아니다 ***
-- 오픈 전 반복 QA(같은 휴대폰으로 최초등록 → OTP → 사례 → 간병일지 →
-- 종료를 반복)를 위해, 지정한 범위의 테스트 데이터를 하드 삭제한다.
-- 관리자의 일반 "간병일지 삭제"는 여전히 Soft Delete를 쓴다
-- (20260805090000_care_log_soft_delete.sql) — 하드 삭제는 오직 이
-- 파일의 함수와 /admin/test-reset 경로에서만 일어난다.
--
-- *** 안전장치(설계 원칙) ***
--   - "전체 삭제" 함수는 만들지 않는다. 반드시 case/caregiver/hospital 중
--     하나의 대상 id를 지정해야 한다.
--   - authenticated/anon에는 실행 권한을 주지 않는다(service_role 전용).
--     호출부(app/api/admin/test-reset/**)가 requireAdminApi()로 관리자
--     인증을 먼저 확인하고, Preview 기록 확인 + "RESET" 확인문구까지
--     통과한 뒤에만 호출한다.
--   - 병원 자체는 기본적으로 유지한다(같은 QR로 반복 테스트하기 위함).
--     p_delete_hospital = true일 때만 병원 행까지 지운다.
--   - Storage(care-log-photos 버킷) 파일 삭제는 DB 트랜잭션에 포함할 수
--     없으므로 API가 "Storage 먼저 삭제 → 성공하면 이 RPC 실행" 순서로
--     처리한다(파일 삭제가 실패하면 DB는 건드리지 않는다).
--
-- 선행 조건: 20260806090100_case_consents.sql(case_consents),
-- 20260804090000_caregiver_session_tables.sql(caregiver_sessions,
-- caregiver_otp_codes)이 먼저 적용되어 있어야 한다.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. 내부 헬퍼: 사례 1건의 하위 데이터 + 사례 자체를 삭제
-- ----------------------------------------------------------------------------
-- FK 의존 순서를 지켜 하위 → 상위 순으로 지운다. caregiver/세션/OTP는
-- 호출하는 쪽에서 별도로 판단해 처리한다(여기서는 건드리지 않는다).
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
  if p_case_id is null then
    raise exception 'invalid_case_id' using errcode = '22023';
  end if;

  delete from care_log_photos
  where log_id in (select log_id from care_logs where case_id = p_case_id);
  get diagnostics v_photos = row_count;

  delete from care_logs where case_id = p_case_id;
  get diagnostics v_logs = row_count;

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

revoke all on function reset_test_case_data(uuid) from public;


-- ----------------------------------------------------------------------------
-- 0-1. 내부 헬퍼: caregiver 1명의 세션/OTP 정리 + 조건부 caregiver 삭제
-- ----------------------------------------------------------------------------
-- 다른 사례에 아직 연결(case_caregivers)이 남아 있으면 caregiver 행은
-- 삭제하지 않고, 세션/OTP만 정리한다(같은 번호로 다시 OTP부터 테스트할 수
-- 있게 하기 위함). 연결이 하나도 없으면 caregiver 행까지 삭제하며, 이때
-- 암호화된 주민등록번호 컬럼도 행과 함께 사라진다.
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
  if p_caregiver_id is null then
    raise exception 'invalid_caregiver_id' using errcode = '22023';
  end if;

  select phone_normalized into v_phone
  from caregivers
  where caregiver_id = p_caregiver_id;

  if v_phone is null then
    -- 이미 삭제되었거나 존재하지 않는 caregiver — 조용히 0건 반환.
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

    delete from caregivers where caregiver_id = p_caregiver_id;
    get diagnostics v_caregivers = row_count;
  elsif p_revoke_sessions then
    -- caregiver는 유지하되(다른 사례에 연결됨) 세션만 제거해 재로그인부터
    -- 다시 테스트할 수 있게 한다.
    delete from caregiver_sessions where caregiver_id = p_caregiver_id;
    get diagnostics v_sessions = row_count;
  end if;

  return query select v_caregivers, v_sessions, v_otp;
end;
$$;

revoke all on function reset_test_caregiver_cleanup(uuid, boolean) from public;


-- ----------------------------------------------------------------------------
-- 1. reset_test_case: 사례 1건 기준 초기화
-- ----------------------------------------------------------------------------
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

revoke all on function reset_test_case(uuid, boolean) from public;


-- ----------------------------------------------------------------------------
-- 2. reset_test_caregiver: 간병인 + "관리자가 선택한 사례들" 기준 초기화
-- ----------------------------------------------------------------------------
-- 휴대폰 번호 기준 초기화의 실제 구현. "이 간병인의 모든 사례를 지운다"가
-- 아니라, 관리자가 Preview에서 체크한 case_id 배열만 처리한다.
-- 각 사례에 대해:
--   - 이 caregiver의 동의/간병일지/사진/연결을 삭제하고,
--   - 그 결과 사례에 남은 간병인이 하나도 없으면 사례 전체를 삭제한다.
--   - 다른 간병인이 남아 있으면 사례와 그 사례의 case_history는 유지한다
--     (아직 살아있는 사례의 감사 이력을 지우지 않는다).
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

revoke all on function reset_test_caregiver(uuid, uuid[], boolean) from public;


-- ----------------------------------------------------------------------------
-- 3. reset_test_hospital: 병원 1곳의 테스트 사례 데이터 초기화
-- ----------------------------------------------------------------------------
-- 기본값은 "병원/QR은 유지하고 사례 데이터만 초기화"다(같은 QR로 반복
-- 테스트하기 위함). p_delete_hospital = true일 때만 병원 행까지 지운다.
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

revoke all on function reset_test_hospital(uuid, boolean, boolean) from public;


-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- drop function if exists reset_test_hospital(uuid, boolean, boolean);
-- drop function if exists reset_test_caregiver(uuid, uuid[], boolean);
-- drop function if exists reset_test_case(uuid, boolean);
-- drop function if exists reset_test_caregiver_cleanup(uuid, boolean);
-- drop function if exists reset_test_case_data(uuid);
