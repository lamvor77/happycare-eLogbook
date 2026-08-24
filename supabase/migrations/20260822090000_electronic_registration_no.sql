-- ============================================================================
-- 전자일지 자체 등록번호(E-YYMMDD-NNN) 생성 + 기존 가족간병관리 시스템
-- 연동 상태 컬럼 — 운영 DB에 자동 실행하지 않는다.
-- ============================================================================
-- 이 파일은 20260806090100_case_consents.sql(register_case_v3 최초 정의)이
-- 이미 적용되어 있어야 한다.
--
-- *** 목적 ***
--   1) 병원 QR 최초 등록(register_case_v3, source_type='hospital_qr')이
--      새로 만드는 사례에 "E" + YYMMDD + "-" + 3자리 일련번호 형식의
--      registration_no를 서버에서 채번해 채운다(기존에는 항상 null이었다
--      — 20260806090100_case_consents.sql 참고). 같은 날짜에 동시에 여러
--      건이 등록돼도 번호가 겹치지 않도록, 날짜별 카운터 테이블에 원자적
--      UPSERT(ON CONFLICT DO UPDATE ... RETURNING)로 채번한다 —
--      클라이언트는 번호를 생성하지 않는다.
--      "E" 접두는 기존 가족간병관리(Google Form) 등록번호 형식(예:
--      260821-001, "E"로 시작하지 않음)과 절대 겹치지 않도록 이 전자일지
--      시스템 전용으로 예약한다. cases.registration_no에는 이미 Google
--      Form 동기화가 의존하는 UNIQUE 제약이 있어(app/api/google-form-sync/
--      route.ts의 onConflict: "registration_no"), 이론상 충돌이 생기면
--      register_case_v3 자체가 UNIQUE 위반으로 실패한다(23505) —
--      "E" 접두를 이 시스템 전용으로 예약해 실질적으로 발생하지 않는다.
--   2) cases에 legacy_sync_status/legacy_synced_at/legacy_sync_error
--      컬럼을 추가한다 — 기존 가족간병관리 시스템으로의 전송 상태만
--      기록하고, 전송한 payload 원문(간병인 주민등록번호 포함)은 저장하지
--      않는다(lib/legacy-sync.ts 참고, 작업 E/F 원칙).
--      Google Form으로 들어온 사례(source_type='google_form')는 애초에
--      기존 시스템에서 온 데이터라 동기화 대상이 아니므로 이 컬럼들을
--      계속 null로 둔다(app/api/google-form-sync/route.ts는 변경하지
--      않는다).
--
-- *** 롤백 시 주의 ***
-- register_case_v3를 20260806090100_case_consents.sql 버전으로 되돌리려면
-- 이 파일 끝의 ROLLBACK 섹션 대신 그 파일의 CREATE OR REPLACE 블록을 다시
-- 실행해야 한다(이 파일은 새 버전을 CREATE OR REPLACE로 덮어씀).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. 날짜별 등록번호 일련번호 카운터
-- ----------------------------------------------------------------------------
create table if not exists registration_no_counters (
  reg_date date primary key,
  last_serial integer not null default 0
);

alter table registration_no_counters enable row level security;
-- 정책 없음(기본 전면 거부) — generate_e_registration_no()(SECURITY
-- DEFINER)를 통해서만 접근한다. 관리자 화면도 이 테이블을 직접 조회할
-- 필요가 없다(등록번호 결과는 cases.registration_no로 이미 노출된다).

create or replace function generate_e_registration_no()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- case_no/family_code(위 두 값은 register_case_v3 안에서 to_char(now(), ...)/
  -- clock_timestamp()로 세션 기본 타임존을 그대로 쓴다)와 달리, 등록번호는
  -- 한국 사용자 기준 "오늘 날짜"가 실제 업무일과 어긋나지 않아야 하므로
  -- Asia/Seoul로 명시 변환한다. 이 함수만의 결정이며 case_no 생성 방식은
  -- 건드리지 않는다.
  v_now timestamptz := now() at time zone 'Asia/Seoul';
  v_today date := v_now::date;
  v_yymmdd text := to_char(v_now, 'YYMMDD');
  v_serial integer;
begin
  insert into registration_no_counters (reg_date, last_serial)
  values (v_today, 1)
  on conflict (reg_date)
  do update set last_serial = registration_no_counters.last_serial + 1
  returning last_serial into v_serial;

  return 'E' || v_yymmdd || '-' || lpad(v_serial::text, 3, '0');
end;
$$;

revoke all on function generate_e_registration_no() from public;


-- ----------------------------------------------------------------------------
-- 2. cases: 기존 시스템 연동 상태 컬럼
-- ----------------------------------------------------------------------------
alter table cases add column if not exists legacy_sync_status text;
alter table cases add column if not exists legacy_synced_at timestamptz;
alter table cases add column if not exists legacy_sync_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cases_legacy_sync_status_check'
  ) then
    alter table cases add constraint cases_legacy_sync_status_check
      check (legacy_sync_status is null or legacy_sync_status in ('pending', 'synced', 'failed'));
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 3. register_case_v3 재정의: 신규 사례 생성 시에만 E-등록번호를 채번하고
--    legacy_sync_status를 'pending'으로 설정한다. 그 외 로직은
--    20260806090100_case_consents.sql과 완전히 동일하다(기존 사례 재사용
--    분기는 새 사례를 만들지 않으므로 registration_no/연동 상태 모두
--    건드리지 않는다).
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

  select cases.case_id, cases.case_no, cases.family_code
    into v_existing_case_id, v_existing_case_no, v_existing_family_code
  from cases
  where cases.hospital_id = p_hospital_id
    and cases.patient_name = p_patient_name
    and cases.patient_birth_date is not distinct from p_patient_birth_date
    and cases.status = '입원중'
  limit 1;

  if v_existing_case_id is not null then
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

  v_case_no := 'C' || to_char(now(), 'YYMMDD') || '-' || upper(substr(md5(random()::text), 1, 4));
  v_family_code := 'FC-' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text;
  v_registration_no := generate_e_registration_no();

  insert into cases (
    hospital_id, case_no, registration_no, source_type, family_code,
    patient_name, patient_birth_date, patient_phone, patient_gender,
    diagnosis_name, room_no, insurance_company, accident_type, accident_type_etc,
    planner_name, planner_phone, care_start_date, care_end_date, memo,
    privacy_agreed, status, legacy_sync_status
  ) values (
    p_hospital_id, v_case_no, v_registration_no, 'hospital_qr', v_family_code,
    p_patient_name, p_patient_birth_date, p_patient_phone, p_patient_gender,
    p_diagnosis_name, p_room_no, p_insurance_company, p_accident_type, p_accident_type_etc,
    p_planner_name, p_planner_phone, p_care_start_date, p_care_end_date, p_memo,
    p_privacy_agreed, '입원중', 'pending'
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
-- route.ts가 OTP 검증 후 service_role로만 호출한다(20260806090100_
-- case_consents.sql과 동일한 신뢰 모델).

-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- 함수를 이전 버전(등록번호 항상 null)으로 되돌리려면
-- 20260806090100_case_consents.sql의 CREATE OR REPLACE FUNCTION 블록을
-- 다시 실행한다. 카운터/컬럼만 되돌리려면:
--
-- alter table cases drop constraint if exists cases_legacy_sync_status_check;
-- alter table cases drop column if exists legacy_sync_status;
-- alter table cases drop column if exists legacy_synced_at;
-- alter table cases drop column if exists legacy_sync_error;
-- drop function if exists generate_e_registration_no();
-- drop table if exists registration_no_counters;
