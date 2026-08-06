-- ============================================================================
-- case_consents 테이블 + register_case_v3 RPC — 운영 DB에 자동 실행하지
-- 않는다.
-- ============================================================================
-- 이 파일은 아래 순서로 이미 적용되어 있어야 한다:
--   1. 20260803120000_caregiver_auth_link.sql (phone_normalized 등)
--   2. 20260804090000_caregiver_session_tables.sql
--   3. 20260804090100_caregiver_session_functions.sql (register_case_v2 등)
--   4. 20260806090000_encrypt_caregiver_resident_number.sql (암호화 컬럼)
--
-- *** 목적 ***
-- 최초 등록(QR) 화면의 동의 6개 항목을 개별 컬럼으로 기록하고, 간병인
-- 주민등록번호 전체 13자리를 "암호화된 값만" 받아 caregiver/case/
-- case_caregiver/case_consents를 하나의 트랜잭션(SECURITY DEFINER 함수
-- 전체가 한 트랜잭션)으로 원자적으로 생성한다 — 중간에 실패하면 전부
-- 롤백되어 고아 데이터가 생기지 않는다.
--
-- *** register_case_v2와의 관계 ***
-- v2 함수는 삭제하지 않는다(호환/롤백용으로 유지). 신규 QR 최초 등록
-- 화면(app/case-register)은 이제 register_case_v3만 호출한다.
-- app/case-join(가족간병인 추가)은 이번 작업 범위에 포함되지 않아 계속
-- join_case_v2(주민등록번호 앞 7자리만, 선택)를 그대로 사용한다 —
-- docs/registration-field-mapping.md에 이 차이를 명시해 둔다.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. case_consents 테이블
-- ----------------------------------------------------------------------------
create table if not exists case_consents (
  consent_id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(case_id) on delete cascade,
  caregiver_id uuid not null references caregivers(caregiver_id),
  consent_version text not null,
  integrated_care_ward_confirmed boolean not null,
  direct_care_confirmed boolean not null,
  false_application_confirmed boolean not null,
  insurance_not_guaranteed_confirmed boolean not null,
  information_accuracy_confirmed boolean not null,
  privacy_consent_confirmed boolean not null,
  consented_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_case_consents_case_id
  on case_consents (case_id);

alter table case_consents enable row level security;

-- case_history와 동일한 조회 정책: 이 사례에 연결된 caregiver 본인(단,
-- 캐어기버 경로는 실제로는 service_role로 우회 — lib/caregiver-auth.ts)
-- 또는 관리자만 조회 가능.
drop policy if exists case_consents_select on case_consents;
create policy case_consents_select on case_consents
  for select
  using (case_id in (select my_case_ids()) or is_admin());

-- insert/update/delete 정책 없음(기본 거부) — 오직 register_case_v3
-- (SECURITY DEFINER)를 통해서만 생성되고, 이후 절대 수정/삭제하지 않는다
-- (동의 기록은 불변 로그 성격 — case_history와 동일 원칙).
revoke insert, update, delete on case_consents from anon, authenticated;

-- IP/User-Agent 등 추가 식별정보는 저장하지 않는다(개인정보 최소 수집
-- 원칙 — 운영 법무 검토에서 필요하다고 판단되면 별도 컬럼을 추가할 것,
-- docs/privacy-data-policy.md에 "운영 확인 필요"로 남겨둔다).


-- ----------------------------------------------------------------------------
-- 2. register_case_v3: 암호화된 주민등록번호 + 동의 6개 항목 포함
-- ----------------------------------------------------------------------------
create or replace function register_case_v3(
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
  p_resident_number_masked text,
  p_resident_number_ciphertext text,
  p_resident_number_iv text,
  p_resident_number_auth_tag text,
  p_resident_number_key_version integer,
  p_consent_version text,
  p_consent_integrated_care_ward boolean,
  p_consent_direct_care boolean,
  p_consent_false_application boolean,
  p_consent_insurance_not_guaranteed boolean,
  p_consent_information_accuracy boolean,
  p_consent_privacy boolean
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

  if not (
    coalesce(p_consent_integrated_care_ward, false)
    and coalesce(p_consent_direct_care, false)
    and coalesce(p_consent_false_application, false)
    and coalesce(p_consent_insurance_not_guaranteed, false)
    and coalesce(p_consent_information_accuracy, false)
    and coalesce(p_consent_privacy, false)
  ) then
    raise exception 'consent_incomplete' using errcode = '22023';
  end if;

  if p_consent_version is null or p_consent_version = '' then
    raise exception 'invalid_consent_version' using errcode = '22023';
  end if;

  if p_caregiver_phone_normalized is null or p_caregiver_phone_normalized = '' then
    raise exception 'invalid_caregiver_phone' using errcode = '22023';
  end if;

  -- 주민등록번호 필수 여부는 아래에서 "신규 caregiver를 생성하는 경우"에만
  -- 검사한다(기존 세션으로 재방문 등록하는 caregiver는 이미 최초 등록 시
  -- 암호화된 값을 갖고 있으므로 매번 다시 요구하지 않는다 — 요청 본문에도
  -- 다시 담아 보내지 않는다).

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

  -- caregiver 재사용(phone_normalized 기준) 또는 신규 생성. register_case_v2와
  -- 동일하게, 이미 존재하는 caregiver라면 주민등록번호 관련 컬럼을 덮어쓰지
  -- 않는다(재방문 등록 시 최초 등록값을 유지 — v2의 기존 동작과 일관).
  select caregivers.caregiver_id into v_caregiver_id
  from caregivers
  where caregivers.phone_normalized = p_caregiver_phone_normalized;

  if v_caregiver_id is null then
    -- 신규 caregiver 생성 시에만 암호화된 주민등록번호 전체 13자리를
    -- 필수로 요구한다(원문은 이 함수 파라미터로도 전달되지 않는다 —
    -- app/api/cases/register/route.ts가 lib/caregiver-resident-number.ts로
    -- 암호화한 결과만 전달한다).
    if p_resident_number_masked is null or p_resident_number_masked = ''
       or p_resident_number_ciphertext is null or p_resident_number_ciphertext = ''
       or p_resident_number_iv is null or p_resident_number_iv = ''
       or p_resident_number_auth_tag is null or p_resident_number_auth_tag = ''
       or p_resident_number_key_version is null then
      raise exception 'invalid_resident_number' using errcode = '22023';
    end if;

    insert into caregivers (
      caregiver_name, phone, phone_normalized,
      resident_number_masked,
      resident_number_ciphertext, resident_number_iv,
      resident_number_auth_tag, resident_number_key_version,
      otp_verified_at
    )
    values (
      p_caregiver_name, p_caregiver_phone_normalized, p_caregiver_phone_normalized,
      p_resident_number_masked,
      p_resident_number_ciphertext, p_resident_number_iv,
      p_resident_number_auth_tag, p_resident_number_key_version,
      now()
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

  insert into case_consents (
    case_id, caregiver_id, consent_version,
    integrated_care_ward_confirmed, direct_care_confirmed,
    false_application_confirmed, insurance_not_guaranteed_confirmed,
    information_accuracy_confirmed, privacy_consent_confirmed,
    consented_at
  ) values (
    v_case_id, v_caregiver_id, p_consent_version,
    p_consent_integrated_care_ward, p_consent_direct_care,
    p_consent_false_application, p_consent_insurance_not_guaranteed,
    p_consent_information_accuracy, p_consent_privacy,
    now()
  );

  return query select v_case_id, v_case_no, v_family_code, false, v_caregiver_id;
end;
$$;

revoke all on function register_case_v3(
  uuid, text, date, text, text, text, text, text, text, text, text,
  text, text, date, date, text, boolean, text, text,
  text, text, text, text, integer,
  text, boolean, boolean, boolean, boolean, boolean, boolean
) from public;

-- authenticated/anon에는 실행 권한을 주지 않는다 — app/api/cases/register/
-- route.ts가 OTP 검증 후 service_role로만 호출한다(register_case_v2와
-- 동일한 신뢰 모델, 20260804090100_caregiver_session_functions.sql 참고).

-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- drop function if exists register_case_v3(
--   uuid, text, date, text, text, text, text, text, text, text, text,
--   text, text, date, date, text, boolean, text, text,
--   text, text, text, text, integer,
--   text, boolean, boolean, boolean, boolean, boolean, boolean
-- );
-- drop policy if exists case_consents_select on case_consents;
-- drop table if exists case_consents;
