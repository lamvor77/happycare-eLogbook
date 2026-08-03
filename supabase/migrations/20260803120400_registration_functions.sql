-- ============================================================================
-- 최초 등록(register_case) / 가족간병인 참여(join_case) RPC 함수
-- ============================================================================
-- 운영 DB에 자동 실행되지 않는다. 검토 후 수동 적용할 것.
--
-- 목적: app/api/cases/register, app/api/cases/join 이 이 함수들을 호출한다.
-- 두 함수 모두 SECURITY DEFINER로 실행되어 RLS를 우회하므로, 함수 내부에서
-- auth.uid() 존재 여부를 반드시 확인한다. 여러 테이블에 걸친 insert를 한
-- 함수 호출(하나의 트랜잭션) 안에서 수행하므로, 중간 실패 시 전체가
-- 롤백되어 "caregiver만 생성되고 case가 없는" 고아 데이터가 생기지 않는다.
--
-- 적용 전 체크리스트:
--   1. 20260803120000_caregiver_auth_link.sql 이 먼저 적용되어 있어야 한다
--      (auth_user_id, phone_normalized, resident_number_masked 컬럼 필요).
--   2. cases.case_no, cases.family_code에 유니크 제약이 있다면 아래 생성
--      로직과 충돌하지 않는지 확인한다(무작위 생성이므로 충돌 확률은 낮지만
--      0은 아니다 — 운영 트래픽이 커지면 재시도 로직을 추가로 검토할 것).
-- ============================================================================

create or replace function register_case(
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
  out_is_existing boolean
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
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_privacy_agreed is not true then
    raise exception 'privacy_not_agreed' using errcode = '22023';
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
    return query select v_existing_case_id, v_existing_case_no, v_existing_family_code, true;
    return;
  end if;

  -- caregiver 재사용(auth_user_id 기준) 또는 신규 생성.
  select caregivers.caregiver_id into v_caregiver_id
  from caregivers
  where caregivers.auth_user_id = auth.uid();

  if v_caregiver_id is null then
    insert into caregivers (
      caregiver_name, phone, phone_normalized, auth_user_id,
      resident_number_masked, otp_verified_at
    )
    values (
      p_caregiver_name, p_caregiver_phone_normalized, p_caregiver_phone_normalized,
      auth.uid(), p_resident_number_masked, now()
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

  return query select v_case_id, v_case_no, v_family_code, false;
end;
$$;

revoke all on function register_case(
  uuid, text, date, text, text, text, text, text, text, text, text,
  text, text, date, date, text, boolean, text, text, text
) from public;

grant execute on function register_case(
  uuid, text, date, text, text, text, text, text, text, text, text,
  text, text, date, date, text, boolean, text, text, text
) to authenticated;


-- ----------------------------------------------------------------------------
-- 가족간병인 참여
-- ----------------------------------------------------------------------------
create or replace function join_case(
  p_family_code text,
  p_relationship text,
  p_caregiver_name text,
  p_caregiver_phone_normalized text,
  p_resident_number_masked text default null
)
returns table (
  out_case_id uuid,
  out_patient_name text,
  out_already_joined boolean
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
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
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
  where caregivers.auth_user_id = auth.uid();

  if v_caregiver_id is null then
    insert into caregivers (
      caregiver_name, phone, phone_normalized, auth_user_id,
      resident_number_masked, otp_verified_at
    )
    values (
      p_caregiver_name, p_caregiver_phone_normalized, p_caregiver_phone_normalized,
      auth.uid(), p_resident_number_masked, now()
    )
    returning caregiver_id into v_caregiver_id;
  end if;

  select case_caregivers.case_caregiver_id into v_existing_link
  from case_caregivers
  where case_caregivers.case_id = v_case_id
    and case_caregivers.caregiver_id = v_caregiver_id;

  if v_existing_link is not null then
    return query select v_case_id, v_patient_name, true;
    return;
  end if;

  insert into case_caregivers (
    case_id, caregiver_id, relationship, is_primary_caregiver, is_current_caregiver, status
  )
  values (v_case_id, v_caregiver_id, p_relationship, false, false, '활성');

  return query select v_case_id, v_patient_name, false;
end;
$$;

revoke all on function join_case(text, text, text, text, text) from public;
grant execute on function join_case(text, text, text, text, text) to authenticated;

-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- drop function if exists join_case(text, text, text, text, text);
-- drop function if exists register_case(
--   uuid, text, date, text, text, text, text, text, text, text, text,
--   text, text, date, date, text, boolean, text, text, text
-- );
