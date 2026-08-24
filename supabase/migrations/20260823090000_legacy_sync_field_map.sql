-- ============================================================================
-- 실제 기존 가족간병관리 Sheet 헤더 연동을 위한 컬럼 추가 + register_case_v3
-- 원자성 보완 — 운영 DB에 자동 실행하지 않는다.
-- ============================================================================
-- [운영 DB 상태 — 2026-08-24] 이 파일이 적용한 register_case_v3(33
-- 파라미터, admission_status/insurance_company_other 포함)는 운영 DB에
-- 이미 반영되어 있고 실제 QR 등록 1건으로 검증 완료됐다. 재실행하지
-- 않는다 — 상세 현황은 docs/legacy-sync-integration.md "운영 DB 적용
-- 이력" 절 참고.
-- ============================================================================
-- 실제 Sheet 헤더가 확인되어(docs/legacy-family-care-field-map.md) outbound
-- payload에 아래 두 값을 반드시 함께 보내야 한다는 것이 확정됐다:
--   - 현재상태(admission_status): QR 등록 화면에서 이미 수집하지만 지금까지
--     DB 컬럼이 없어 서버가 버렸다(20260806090100_case_consents.sql 이전
--     문서 참고). 재전송(관리자 [다시 전송])이 등록 시점과 동일한 값을
--     다시 보낼 수 있으려면 DB에 남아 있어야 하므로 컬럼을 추가한다.
--   - 보험사 "기타" 선택 시 상세 텍스트(insurance_company_other): 보험사
--     선택지가 기존 Google Form 값을 동적으로 반영하도록 바뀌면서(작업
--     15~19) "기타" 선택 시의 자유 입력값을 별도로 보관해야 Sheet의
--     "기타인 경우 입력해주세요" 컬럼에 정확히 전달할 수 있다.
--
-- *** 원자성 보완(2026-08-23, 운영 적용 전 최종 보완) ***
-- 최초 버전은 두 컬럼을 register_case_v3(SECURITY DEFINER RPC) 밖에서
-- app/api/cases/register/route.ts가 RPC 성공 직후 별도 UPDATE로 채웠다.
-- 이번 보완으로 그 UPDATE를 제거하고, register_case_v3에 두 값을
-- 파라미터(p_admission_status, p_insurance_company_other)로 추가해 사례
-- 생성과 같은 트랜잭션 안에서 저장하도록 바꾼다 — RPC가 성공했는데 뒤이은
-- UPDATE만 실패해 두 값이 비어 있는 상태가 생기는 것을 막기 위함이다.
-- 이 파일이 register_case_v3의 최신 정의를 포함한다(20260806090100_
-- case_consents.sql → 20260822090000_electronic_registration_no.sql →
-- 이 파일 순으로 CREATE OR REPLACE가 누적된다. v2는 계속 그대로 둔다).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. cases: 신규 컬럼
-- ----------------------------------------------------------------------------
alter table cases add column if not exists admission_status text;
alter table cases add column if not exists insurance_company_other text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cases_admission_status_check'
  ) then
    alter table cases add constraint cases_admission_status_check
      check (admission_status is null or admission_status in ('입원 예정', '입원 당일', '입원 중'));
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 2. register_case_v3 재정의: p_admission_status/p_insurance_company_other
--    파라미터를 추가하고, 신규 사례 생성 분기에서만 두 값을 저장한다.
--    기존 사례 재사용 분기는 cases 테이블 자체를 전혀 UPDATE하지 않으므로
--    (아래 코드에서 확인 가능) 기존 사례의 admission_status/
--    insurance_company_other/insurance_company를 이 함수가 덮어쓸 방법이
--    없다 — 별도 조치 없이 이미 안전하다.
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
  p_consent_privacy boolean,
  p_admission_status text,
  p_insurance_company_other text
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
  v_registration_no text;
  v_case_id uuid;
  v_existing_link_id uuid;
  v_has_current_caregiver boolean;
  v_consent_exists boolean;
  v_link_created boolean;
  v_consent_created boolean;
  v_history_description text;
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

  -- 현재상태는 기존 Sheet 표시값과 정확히 같은 3개 문자열만 허용한다
  -- (cases.admission_status의 CHECK 제약과 동일한 목록 — 여기서도 함수
  -- 진입 시점에 명시적으로 막아 에러 메시지를 구분한다).
  if p_admission_status is not null
     and p_admission_status not in ('입원 예정', '입원 당일', '입원 중') then
    raise exception 'invalid_admission_status' using errcode = '22023';
  end if;

  -- 보험사 "기타" 상세 텍스트는 p_insurance_company가 정확히 '기타'일
  -- 때만 값을 가질 수 있다 — 그 외 조합은 클라이언트/서버 로직 오류로
  -- 간주해 거부한다(방어적 검증, app/api/cases/register/route.ts도 같은
  -- 조건으로 이미 걸러 보내지만 RPC 자체에서도 불변조건을 강제한다).
  if p_insurance_company_other is not null and p_insurance_company_other <> ''
     and coalesce(p_insurance_company, '') <> '기타' then
    raise exception 'invalid_insurance_company_other' using errcode = '22023';
  end if;

  if not exists (
    select 1 from hospitals where hospital_id = p_hospital_id and status = 'active'
  ) then
    raise exception 'invalid_hospital' using errcode = '22023';
  end if;

  select caregivers.caregiver_id into v_caregiver_id
  from caregivers
  where caregivers.phone_normalized = p_caregiver_phone_normalized;

  if v_caregiver_id is null then
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
    -- *** 기존 사례 재사용 분기 ***
    -- 이 분기는 cases 테이블을 단 한 번도 UPDATE하지 않는다(case_caregivers/
    -- case_consents/case_history만 insert) — 따라서 기존 사례의
    -- admission_status/insurance_company/insurance_company_other를 포함한
    -- 어떤 cases 컬럼 값도 여기서 절대 덮어쓰지 않는다. p_admission_status/
    -- p_insurance_company_other는 이 분기에서 전혀 참조하지 않는다.
    v_link_created := false;
    v_consent_created := false;

    select case_caregiver_id
      into v_existing_link_id
    from case_caregivers
    where case_id = v_existing_case_id
      and caregiver_id = v_caregiver_id
    limit 1;

    if v_existing_link_id is null then
      select exists (
        select 1 from case_caregivers
        where case_id = v_existing_case_id
          and is_current_caregiver = true
          and status = '활성'
      ) into v_has_current_caregiver;

      insert into case_caregivers (
        case_id, caregiver_id, relationship,
        is_primary_caregiver, is_current_caregiver, status
      )
      values (
        v_existing_case_id, v_caregiver_id, p_relationship,
        false, not v_has_current_caregiver, '활성'
      );

      v_link_created := true;
    end if;

    select exists (
      select 1 from case_consents
      where case_id = v_existing_case_id
        and caregiver_id = v_caregiver_id
    ) into v_consent_exists;

    if not v_consent_exists then
      insert into case_consents (
        case_id, caregiver_id, consent_version,
        integrated_care_ward_confirmed, direct_care_confirmed,
        false_application_confirmed, insurance_not_guaranteed_confirmed,
        information_accuracy_confirmed, privacy_consent_confirmed,
        consented_at
      ) values (
        v_existing_case_id, v_caregiver_id, p_consent_version,
        p_consent_integrated_care_ward, p_consent_direct_care,
        p_consent_false_application, p_consent_insurance_not_guaranteed,
        p_consent_information_accuracy, p_consent_privacy,
        now()
      );

      v_consent_created := true;
    end if;

    if v_link_created and v_consent_created then
      v_history_description := '기존 사례에 간병인으로 새로 연결되고 동의 기록이 생성되었습니다.';
    elsif v_link_created then
      v_history_description := '기존 사례에 간병인으로 새로 연결되었습니다.';
    elsif v_consent_created then
      v_history_description := '기존에 연결된 간병인의 동의 기록이 추가되었습니다.';
    else
      v_history_description := '이미 연결된 간병인이 QR 등록을 다시 시도했습니다(변경 사항 없음).';
    end if;

    insert into case_history (
      case_id, history_type, title, action, description, actor
    ) values (
      v_existing_case_id, 'REGISTER_REUSE', '기존 사례 참여', '등록 재사용',
      v_history_description, p_caregiver_name
    );

    return query select v_existing_case_id, v_existing_case_no, v_existing_family_code, true, v_caregiver_id;
    return;
  end if;

  -- *** 신규 사례 생성 분기 — admission_status/insurance_company_other는
  -- 오직 이 분기에서만 저장된다 ***
  v_case_no := 'C' || to_char(now(), 'YYMMDD') || '-' || upper(substr(md5(random()::text), 1, 4));
  v_family_code := 'FC-' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text;
  v_registration_no := generate_e_registration_no();

  insert into cases (
    hospital_id, case_no, registration_no, source_type, family_code,
    patient_name, patient_birth_date, patient_phone, patient_gender,
    diagnosis_name, room_no, insurance_company, accident_type, accident_type_etc,
    planner_name, planner_phone, care_start_date, care_end_date, memo,
    privacy_agreed, status, legacy_sync_status,
    admission_status, insurance_company_other
  ) values (
    p_hospital_id, v_case_no, v_registration_no, 'hospital_qr', v_family_code,
    p_patient_name, p_patient_birth_date, p_patient_phone, p_patient_gender,
    p_diagnosis_name, p_room_no, p_insurance_company, p_accident_type, p_accident_type_etc,
    p_planner_name, p_planner_phone, p_care_start_date, p_care_end_date, p_memo,
    p_privacy_agreed, '입원중', 'pending',
    p_admission_status,
    case when p_insurance_company = '기타' then p_insurance_company_other else null end
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

-- 이전 시그니처(20260822090000_electronic_registration_no.sql, 파라미터
-- 31개)는 그대로 두면 오버로드로 남아 혼동을 줄 수 있으므로 명시적으로
-- drop한다 — v2와는 별개다(v2는 완전히 다른 함수명이라 영향 없음).
drop function if exists register_case_v3(
  uuid, text, date, text, text, text, text, text, text, text, text,
  text, text, date, date, text, boolean, text, text,
  text, text, text, text, integer,
  text, boolean, boolean, boolean, boolean, boolean, boolean
);

revoke all on function register_case_v3(
  uuid, text, date, text, text, text, text, text, text, text, text,
  text, text, date, date, text, boolean, text, text,
  text, text, text, text, integer,
  text, boolean, boolean, boolean, boolean, boolean, boolean,
  text, text
) from public;

-- authenticated/anon에는 실행 권한을 주지 않는다 — app/api/cases/register/
-- route.ts가 OTP 검증 후 service_role로만 호출한다.

-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- 함수를 이전 버전(admission_status/insurance_company_other 파라미터
-- 없음)으로 되돌리려면 20260822090000_electronic_registration_no.sql의
-- CREATE OR REPLACE FUNCTION 블록을 다시 실행한다(먼저 아래로 33개
-- 파라미터 시그니처를 drop해야 새 31개 파라미터 버전과 오버로드 충돌이
-- 나지 않는다):
--
-- drop function if exists register_case_v3(
--   uuid, text, date, text, text, text, text, text, text, text, text,
--   text, text, date, date, text, boolean, text, text,
--   text, text, text, text, integer,
--   text, boolean, boolean, boolean, boolean, boolean, boolean,
--   text, text
-- );
--
-- 컬럼만 되돌리려면:
-- alter table cases drop constraint if exists cases_admission_status_check;
-- alter table cases drop column if exists admission_status;
-- alter table cases drop column if exists insurance_company_other;
