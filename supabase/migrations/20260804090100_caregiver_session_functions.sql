-- ============================================================================
-- 자체 세션 기반 등록/참여/현재간병인 변경 RPC (v2) — 자동 실행하지 않는다.
-- ============================================================================
-- 이 파일은 20260804090000_caregiver_session_tables.sql 및 기존
-- 20260803120000_caregiver_auth_link.sql(phone_normalized,
-- resident_number_masked 컬럼) 이 먼저 적용되어 있어야 한다.
--
-- *** 기존 register_case/join_case/set_current_caregiver 와의 관계 ***
-- 기존 함수는 삭제하지 않는다(호환/롤백용으로 유지, 이번 파일에서 drop하지
-- 않음). 다만 기존 함수들은 auth.uid()(Supabase Auth 세션)를 전제로 하는데,
-- 간병인은 더 이상 Supabase Auth를 사용하지 않으므로 auth.uid()가 항상
-- null이 되어 사실상 호출할 수 없게 된다(관리자 전용 용도로 남겨두거나,
-- 추후 완전히 걷어낼 때 참고용으로 유지).
--
-- *** 신뢰 모델 ***
-- 아래 v2 함수들은 인증 여부를 auth.uid()로 확인하지 않는다. 대신 우리
-- Next.js 서버 코드가 lib/otp.ts로 OTP를 검증하거나 lib/caregiver-auth.ts로
-- 세션 쿠키를 검증한 "이후에만" service_role 클라이언트로 이 함수들을
-- 호출한다는 것을 전제로 한다. service_role은 애초에 GRANT/RLS를 모두
-- 우회하므로, 아래에서 authenticated/anon에는 실행 권한을 주지 않는다
-- (직접 호출을 원천 차단 — 우리 서버 코드만 호출 가능).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- register_case_v2: 최초 등록(간병인 phone_normalized 기준 재사용/생성)
-- ----------------------------------------------------------------------------
create or replace function register_case_v2(
  p_hospital_id uuid,
  p_patient_name text,
  p_patient_birth_date date,
  p_patient_phone text,
  p_patient_gender text,
  p_relationship text,
  p_diagnosis_name text,
  p_room_no text,
  p_insurance_company text,
  p_accident_type text,
  p_accident_type_etc text,
  p_planner_name text,
  p_planner_phone text,
  p_care_start_date date,
  p_care_end_date date,
  p_memo text,
  p_privacy_agreed boolean,
  p_caregiver_name text,
  p_caregiver_phone_normalized text,
  p_resident_number_masked text default null
)
returns table (
  out_case_id uuid,
  out_case_no text,
  out_family_code text,
  out_is_existing boolean,
  out_caregiver_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caregiver_id uuid;
  v_existing_case_id uuid;
  v_existing_case_no text;
  v_existing_family_code text;
  v_case_no text;
  v_family_code text;
  v_case_id uuid;
begin
  if p_privacy_agreed is not true then
    raise exception 'privacy_not_agreed' using errcode = '22023';
  end if;

  if p_caregiver_phone_normalized is null or p_caregiver_phone_normalized = '' then
    raise exception 'invalid_caregiver_phone' using errcode = '22023';
  end if;

  if not exists (
    select 1 from hospitals where hospital_id = p_hospital_id and status = 'active'
  ) then
    raise exception 'invalid_hospital' using errcode = '22023';
  end if;

  -- 동일 병원 + 환자명 + 생년월일 기준으로 입원중인 기존 사례가 있으면 재사용.
  select cases.case_id, cases.case_no, cases.family_code
    into v_existing_case_id, v_existing_case_no, v_existing_family_code
  from cases
  where cases.hospital_id = p_hospital_id
    and cases.patient_name = p_patient_name
    and cases.patient_birth_date is not distinct from p_patient_birth_date
    and cases.status = '입원중'
  limit 1;

  if v_existing_case_id is not null then
    select caregiver_id into v_caregiver_id
    from caregivers
    where phone_normalized = p_caregiver_phone_normalized;

    return query select v_existing_case_id, v_existing_case_no, v_existing_family_code, true, v_caregiver_id;
    return;
  end if;

  -- caregiver 재사용(phone_normalized 기준) 또는 신규 생성.
  select caregivers.caregiver_id into v_caregiver_id
  from caregivers
  where caregivers.phone_normalized = p_caregiver_phone_normalized;

  if v_caregiver_id is null then
    insert into caregivers (
      caregiver_name, phone, phone_normalized,
      resident_number_masked, otp_verified_at
    )
    values (
      p_caregiver_name, p_caregiver_phone_normalized, p_caregiver_phone_normalized,
      p_resident_number_masked, now()
    )
    returning caregiver_id into v_caregiver_id;
  end if;

  v_case_no := 'C' || to_char(now(), 'YYMMDD') || '-' || upper(substr(md5(random()::text), 1, 4));
  v_family_code := 'FC-' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text;

  insert into cases (
    hospital_id, case_no, registration_no, source_type, family_code,
    patient_name, patient_birth_date, patient_phone, patient_gender,
    diagnosis_name, room_no, insurance_company, accident_type, accident_type_etc,
    planner_name, planner_phone, care_start_date, care_end_date, memo,
    privacy_agreed, status
  ) values (
    p_hospital_id, v_case_no, null, 'hospital_qr', v_family_code,
    p_patient_name, p_patient_birth_date, p_patient_phone, p_patient_gender,
    p_diagnosis_name, p_room_no, p_insurance_company, p_accident_type, p_accident_type_etc,
    p_planner_name, p_planner_phone, p_care_start_date, p_care_end_date, p_memo,
    p_privacy_agreed, '입원중'
  )
  returning cases.case_id into v_case_id;

  insert into case_caregivers (
    case_id, caregiver_id, relationship, is_primary_caregiver, is_current_caregiver, status
  )
  values (v_case_id, v_caregiver_id, p_relationship, true, true, '활성');

  return query select v_case_id, v_case_no, v_family_code, false, v_caregiver_id;
end;
$$;

revoke all on function register_case_v2(
  uuid, text, date, text, text, text, text, text, text, text, text,
  text, text, date, date, text, boolean, text, text, text
) from public;


-- ----------------------------------------------------------------------------
-- join_case_v2: 가족간병인 참여
-- ----------------------------------------------------------------------------
create or replace function join_case_v2(
  p_family_code text,
  p_relationship text,
  p_caregiver_name text,
  p_caregiver_phone_normalized text,
  p_resident_number_masked text default null
)
returns table (
  out_case_id uuid,
  out_patient_name text,
  out_already_joined boolean,
  out_caregiver_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case_id uuid;
  v_patient_name text;
  v_caregiver_id uuid;
  v_existing_link uuid;
begin
  if p_caregiver_phone_normalized is null or p_caregiver_phone_normalized = '' then
    raise exception 'invalid_caregiver_phone' using errcode = '22023';
  end if;

  select cases.case_id, cases.patient_name
    into v_case_id, v_patient_name
  from cases
  where cases.family_code = p_family_code
  limit 1;

  if v_case_id is null then
    raise exception 'invalid_family_code' using errcode = '22023';
  end if;

  select caregivers.caregiver_id into v_caregiver_id
  from caregivers
  where caregivers.phone_normalized = p_caregiver_phone_normalized;

  if v_caregiver_id is null then
    insert into caregivers (
      caregiver_name, phone, phone_normalized,
      resident_number_masked, otp_verified_at
    )
    values (
      p_caregiver_name, p_caregiver_phone_normalized, p_caregiver_phone_normalized,
      p_resident_number_masked, now()
    )
    returning caregiver_id into v_caregiver_id;
  end if;

  select case_caregivers.case_caregiver_id into v_existing_link
  from case_caregivers
  where case_caregivers.case_id = v_case_id
    and case_caregivers.caregiver_id = v_caregiver_id;

  if v_existing_link is not null then
    return query select v_case_id, v_patient_name, true, v_caregiver_id;
    return;
  end if;

  insert into case_caregivers (
    case_id, caregiver_id, relationship, is_primary_caregiver, is_current_caregiver, status
  )
  values (v_case_id, v_caregiver_id, p_relationship, false, false, '활성');

  return query select v_case_id, v_patient_name, false, v_caregiver_id;
end;
$$;

revoke all on function join_case_v2(text, text, text, text, text) from public;


-- ----------------------------------------------------------------------------
-- set_current_caregiver_v2: 현재 간병인 변경(원자적 스왑)
-- ----------------------------------------------------------------------------
-- 요청자 검증은 auth.uid() 대신 호출부(lib/caregiver-auth.ts의
-- requireCurrentCaregiverSession)가 세션 쿠키로 이미 확인한 caregiver_id를
-- p_requesting_caregiver_id로 전달받아 여기서 한 번 더 확인한다.
create or replace function set_current_caregiver_v2(
  p_case_id uuid,
  p_requesting_caregiver_id uuid,
  p_new_case_caregiver_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_requester_current boolean;
  v_target_case_id uuid;
  v_target_status text;
begin
  select exists (
    select 1 from case_caregivers cc
    where cc.case_id = p_case_id
      and cc.caregiver_id = p_requesting_caregiver_id
      and cc.is_current_caregiver = true
      and cc.status = '활성'
  ) into v_is_requester_current;

  if not v_is_requester_current then
    raise exception 'not_current_caregiver' using errcode = '42501';
  end if;

  select case_id, status
    into v_target_case_id, v_target_status
  from case_caregivers
  where case_caregiver_id = p_new_case_caregiver_id;

  if v_target_case_id is null or v_target_case_id <> p_case_id then
    raise exception 'invalid_target_caregiver' using errcode = '22023';
  end if;

  if v_target_status <> '활성' then
    raise exception 'inactive_target_caregiver' using errcode = '22023';
  end if;

  -- 재사용: 20260803120200_case_caregiver_functions.sql의
  -- uq_case_caregivers_one_current 부분 유니크 인덱스가 이미 존재하므로
  -- 여기서 다시 만들지 않는다.
  update case_caregivers
    set is_current_caregiver = false
    where case_id = p_case_id
      and is_current_caregiver = true;

  update case_caregivers
    set is_current_caregiver = true
    where case_caregiver_id = p_new_case_caregiver_id;
end;
$$;

revoke all on function set_current_caregiver_v2(uuid, uuid, uuid) from public;

-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- drop function if exists set_current_caregiver_v2(uuid, uuid, uuid);
-- drop function if exists join_case_v2(text, text, text, text, text);
-- drop function if exists register_case_v2(
--   uuid, text, date, text, text, text, text, text, text, text, text,
--   text, text, date, date, text, boolean, text, text, text
-- );
