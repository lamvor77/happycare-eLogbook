-- ============================================================================
-- join_case_v3 — 가족간병인 참여(주민등록번호 13자리 + 동의 + 등록 건 생성)
-- ============================================================================
-- *** 상태: 초안 — 운영 DB 미적용 ***
-- 아직 실행하지 않았다. 검토 후 별도 승인 시 적용한다.
--
-- *** 선행 조건 ***
--   - 20260827090000_caregiver_registrations.sql (적용 완료)
--   - 20260827093000_backfill_initial_caregiver_registrations.sql (적용 완료)
--
-- *** join_case_v2와의 관계 ***
-- v2는 삭제하지도 변경하지도 않는다(register_case_v2를 남겨둔 것과 같은
-- 원칙 — 호환/롤백용). 참여 화면(app/case-join)이 v3만 호출하도록 바뀐다.
--
-- v2 대비 달라지는 것:
--   1. 주민등록번호를 앞 7자리 마스킹(선택)이 아니라 13자리 암호화 컬럼으로
--      받는다 — 최초 등록(register_case_v3)과 완전히 같은 저장 방식이다.
--      원문은 이 함수에 들어오지 않는다(서버가 암호화한 결과만 넘긴다).
--   2. 동의 6개를 이 간병인 본인 이름으로 case_consents에 남긴다 —
--      최초 간병인의 동의를 복사하지 않는다.
--   3. generate_e_registration_no()로 새 E등록번호를 발급하고
--      caregiver_registrations에 family_join 등록 건을 만든다.
--      legacy_sync_status는 'pending'으로 시작한다(전송은 응답 이후
--      after() 콜백에서 수행한다).
--
-- *** 이 함수가 하지 않는 것 ***
--   - cases를 UPDATE하지 않는다(registration_no/legacy_sync_* 포함).
--   - 기존 현재 간병인을 교체하지 않는다(is_current_caregiver=false로 연결).
--   - generate_e_registration_no()를 수정하지 않는다(호출만 한다).
--   - 외부 전송(Sheet/알림톡)을 하지 않는다 — 호출부의 after()가 맡는다.
-- ============================================================================

create or replace function join_case_v3(
  p_family_code text,
  p_relationship text,
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
  out_patient_name text,
  out_caregiver_id uuid,
  out_registration_id uuid,
  out_registration_no text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case_id uuid;
  v_patient_name text;
  v_case_status text;
  v_caregiver_id uuid;
  v_existing_link_id uuid;
  v_consent_id uuid;
  v_consent_count integer;
  v_registration_no text;
  v_registration_id uuid;
begin
  -- --------------------------------------------------------------------
  -- 1. 입력 검증
  -- --------------------------------------------------------------------
  if p_caregiver_phone_normalized is null or p_caregiver_phone_normalized = '' then
    raise exception 'invalid_caregiver_phone' using errcode = '22023';
  end if;

  if p_caregiver_name is null or btrim(p_caregiver_name) = '' then
    raise exception 'invalid_caregiver_name' using errcode = '22023';
  end if;

  if p_relationship is null or btrim(p_relationship) = '' then
    raise exception 'invalid_relationship' using errcode = '22023';
  end if;

  -- 동의는 6개 전부 true여야 한다. 호출부(API)도 같은 검증을 하지만,
  -- 클라이언트/이전 단계를 신뢰하지 않는 이 저장소의 원칙대로 RPC에서도
  -- 불변조건을 강제한다.
  if p_consent_version is null or p_consent_version = '' then
    raise exception 'invalid_consent_version' using errcode = '22023';
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

  -- --------------------------------------------------------------------
  -- 2. 가족코드로 사례 조회
  -- --------------------------------------------------------------------
  select cases.case_id, cases.patient_name, cases.status
    into v_case_id, v_patient_name, v_case_status
  from cases
  where cases.family_code = p_family_code
  limit 1;

  if v_case_id is null then
    raise exception 'invalid_family_code' using errcode = '22023';
  end if;

  -- 이미 종료된 사례에는 새로 참여할 수 없다. v2에는 없던 검증이지만,
  -- 종료된 사례에 등록번호를 새로 발급해 Sheet에 접수 행을 만드는 것은
  -- 업무상 의미가 없으므로 여기서 막는다.
  if v_case_status = '간병종료' then
    raise exception 'case_already_ended' using errcode = '22023';
  end if;

  -- --------------------------------------------------------------------
  -- 3. caregiver 조회/생성
  -- --------------------------------------------------------------------
  -- 저장 방식은 register_case_v3와 동일하다(암호화 4개 컬럼 + 마스킹).
  -- 원문은 이 함수에 들어오지 않는다.
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
  else
    -- 이미 있는 간병인(최초 등록 때 이미 13자리를 저장했거나, 과거
    -- join_case_v2로 마스킹만 저장된 경우)이 이번에 13자리를 새로
    -- 제출했다면 암호화 컬럼을 채운다. 이미 채워져 있으면 덮어쓰지
    -- 않는다 — 기존 값을 이 경로에서 바꿀 이유가 없다.
    if p_resident_number_ciphertext is not null and p_resident_number_ciphertext <> '' then
      update caregivers
        set resident_number_masked = coalesce(resident_number_masked, p_resident_number_masked),
            resident_number_ciphertext = p_resident_number_ciphertext,
            resident_number_iv = p_resident_number_iv,
            resident_number_auth_tag = p_resident_number_auth_tag,
            resident_number_key_version = p_resident_number_key_version,
            otp_verified_at = now()
      where caregiver_id = v_caregiver_id
        and resident_number_ciphertext is null;
    end if;
  end if;

  -- --------------------------------------------------------------------
  -- 4. case_caregivers 연결
  -- --------------------------------------------------------------------
  select case_caregiver_id into v_existing_link_id
  from case_caregivers
  where case_id = v_case_id
    and caregiver_id = v_caregiver_id
  limit 1;

  if v_existing_link_id is null then
    -- 추가 참여자는 현재 간병인이 되지 않는다(기존 현재 간병인을 절대
    -- 자동 교체하지 않는다 — 변경은 사례 상세의 "현재 간병인 변경"에서만).
    insert into case_caregivers (
      case_id, caregiver_id, relationship,
      is_primary_caregiver, is_current_caregiver, status
    )
    values (v_case_id, v_caregiver_id, p_relationship, false, false, '활성');
  end if;

  -- --------------------------------------------------------------------
  -- 5. 이미 등록된 간병인인지 먼저 확인
  -- --------------------------------------------------------------------
  -- caregiver_registrations의 UNIQUE(case_id, caregiver_id)가 어차피 막아
  -- 주지만, 그 제약 위반은 아래 동의 처리를 모두 지난 뒤에야 터진다.
  -- 그러면 "이미 참여함"이어야 할 상황이 ambiguous_consent 같은 엉뚱한
  -- 오류로 보고될 수 있어, 여기서 먼저 명확한 오류로 끊는다.
  if exists (
    select 1 from caregiver_registrations
    where case_id = v_case_id
      and caregiver_id = v_caregiver_id
  ) then
    raise exception 'already_registered' using errcode = '22023';
  end if;

  -- --------------------------------------------------------------------
  -- 6. case_consents — 이번 참여에서 본인이 직접 한 동의
  -- --------------------------------------------------------------------
  -- 최초 간병인의 동의를 복사하지 않는다. 그리고 기존 동의 행이 있어도
  -- 재사용하지 않고 이번 참여의 동의를 새로 남긴다 — 업무 원칙이 "추가
  -- 가족간병인이 이번 참여 과정에서 직접 한 동의"를 그 등록 건에 연결하는
  -- 것이기 때문이다. 기존 행을 재사용하면 consented_at(동의 시각)과
  -- consent_version이 과거 값으로 남아, 이번 참여 시점에 실제로 동의했다는
  -- 사실이 기록에서 사라진다. case_consents는 수정/삭제하지 않는 불변 로그
  -- 성격이므로(20260806090100_case_consents.sql) 동의 이벤트마다 행을
  -- 남기는 것이 그 구조와도 맞는다.
  --
  -- 다만 이미 2건 이상 쌓여 있는 조합이라면 그 자체가 비정상이므로
  -- 여기서 중단한다(fail-closed) — 신규 family_join은 consent_id가 비어
  -- 있는 채로 등록번호를 발급받지 않는다. caregiver_registrations.consent_id
  -- 컬럼이 nullable인 것은 과거 initial 데이터 backfill 호환을 위한 것이지,
  -- 신규 참여에서 null을 허용한다는 뜻이 아니다.
  select count(*) into v_consent_count
  from case_consents
  where case_id = v_case_id
    and caregiver_id = v_caregiver_id;

  if v_consent_count >= 2 then
    raise exception 'ambiguous_consent' using errcode = '22023';
  end if;

  insert into case_consents (
    case_id, caregiver_id, consent_version,
    integrated_care_ward_confirmed, direct_care_confirmed,
    false_application_confirmed, insurance_not_guaranteed_confirmed,
    information_accuracy_confirmed, privacy_consent_confirmed,
    consented_at
  )
  values (
    v_case_id, v_caregiver_id, p_consent_version,
    p_consent_integrated_care_ward, p_consent_direct_care,
    p_consent_false_application, p_consent_insurance_not_guaranteed,
    p_consent_information_accuracy, p_consent_privacy,
    now()
  )
  returning consent_id into v_consent_id;

  -- --------------------------------------------------------------------
  -- 7. 새 E등록번호 발급 + 등록 건 생성
  -- --------------------------------------------------------------------
  -- generate_e_registration_no()는 registration_no_counters에
  -- INSERT ... ON CONFLICT DO UPDATE ... RETURNING으로 채번하므로 동시
  -- 호출에도 번호가 중복되지 않는다(행 잠금으로 직렬화됨).
  -- cases.registration_no는 여기서 읽지도 쓰지도 않는다.
  v_registration_no := generate_e_registration_no();

  insert into caregiver_registrations (
    case_id, caregiver_id, registration_no, registration_type,
    relationship, consent_id, legacy_sync_status
  )
  values (
    v_case_id, v_caregiver_id, v_registration_no, 'family_join',
    p_relationship, v_consent_id, 'pending'
  )
  returning registration_id into v_registration_id;

  return query
    select v_case_id, v_patient_name, v_caregiver_id, v_registration_id, v_registration_no;
end;
$$;

revoke all on function join_case_v3(
  text, text, text, text, text, text, text, text, integer,
  text, boolean, boolean, boolean, boolean, boolean, boolean
) from public;

-- authenticated/anon에는 실행 권한을 주지 않는다 — service_role로 호출하는
-- 서버 라우트(app/api/cases/join/route.ts)만 이 함수를 부른다.


-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- join_case_v2는 이 파일에서 건드리지 않았으므로 되돌릴 것이 없다.
--
-- drop function if exists join_case_v3(
--   text, text, text, text, text, text, text, text, integer,
--   text, boolean, boolean, boolean, boolean, boolean, boolean
-- );
