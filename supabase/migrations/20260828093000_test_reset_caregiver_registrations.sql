-- ============================================================================
-- QA 초기화: caregiver_registrations FK 위반 수정
-- ============================================================================
-- [운영 DB 상태 — 2026-08-28] 이 migration은 운영 DB에 적용 완료됐다.
-- 적용 후 실패하던 사례(C260827-B1A2, family_join 등록 건 포함)로 QA 초기화를
-- 재시험해 정상 삭제되는 것을 확인했다. 두 헬퍼 모두 CREATE OR REPLACE라
-- 재실행해도 안전하지만, 그럴 이유가 없다.
--
-- *** 증상(수정 전) ***
-- 관리자 QA 초기화가 "초기화 처리에 실패했습니다."로 실패한다.
-- 실제 원인은 서버 로그에만 남는 FK 위반이다:
--   DELETE FROM case_consents
--   -> caregiver_registrations_consent_id_fkey (SQLSTATE 23503)
--
-- *** 원인 ***
-- 초기화 함수들은 2026-08-07에 작성되어 그 시점 스키마만 안다.
-- caregiver_registrations는 2026-08-27에 추가됐고(20260827090000), 그
-- 테이블의 FK 중 둘은 ON DELETE 옵션이 없다:
--   case_id    -> cases(case_id)            ON DELETE CASCADE
--   caregiver_id -> caregivers(caregiver_id)  (옵션 없음)
--   consent_id -> case_consents(consent_id)   (옵션 없음)
-- 기존 삭제 순서는 case_consents를 cases보다 먼저 지우므로, cases의
-- CASCADE가 도와줄 기회가 오기 전에 consent_id FK가 먼저 걸린다.
--
-- *** 수정 범위 ***
-- 공개 RPC 3종(reset_test_case / reset_test_caregiver / reset_test_hospital)은
-- 실제 삭제를 전부 아래 두 내부 헬퍼에 위임한다(20260807090100 202/207,
-- 323/336, 414/427행). 따라서 헬퍼 두 개만 고치면 3종이 모두 해결된다 —
-- 공개 함수를 불필요하게 재정의해 원본과 어긋날 위험을 만들지 않는다.
--
-- 반환 타입은 바꾸지 않는다. CREATE OR REPLACE로는 반환 타입을 바꿀 수 없어
-- DROP이 필요한데, 이 수정의 목적은 FK 오류 해소이지 집계 스키마 변경이
-- 아니다. 삭제 예정 건수는 preview(읽기 전용 SELECT)에서 보여준다.
--
-- *** 이 파일이 하지 않는 것 ***
--   - 운영 등록/family_join/legacy sync/알림톡 로직을 건드리지 않는다.
--   - RLS 정책, caregiver_registrations 스키마를 바꾸지 않는다.
--   - 공개 RPC 3종의 시그니처/반환값을 바꾸지 않는다.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. reset_test_case_data — 사례 1건의 하위 데이터 삭제
-- ----------------------------------------------------------------------------
-- 20260807090100_test_reset_functions.sql의 정의를 그대로 두고
-- caregiver_registrations 삭제 한 단계만 추가한다(반환값/시그니처 동일).
--
-- 새 순서:
--   care_log_photos
--   care_logs
--   caregiver_registrations   ← 추가 (case_consents보다 먼저)
--   case_consents
--   case_history
--   case_caregivers
--   cases
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

revoke all on function reset_test_case_data(uuid) from public;


-- ----------------------------------------------------------------------------
-- 2. reset_test_caregiver_cleanup — caregiver 세션/OTP 정리 + 조건부 삭제
-- ----------------------------------------------------------------------------
-- 기존 보존 정책을 그대로 지킨다: 다른 사례에 연결(case_caregivers)이 남아
-- 있으면 caregiver 행을 삭제하지 않는다. caregiver_id FK에 ON DELETE 옵션이
-- 없으므로, caregiver를 실제로 지우는 분기에서만 남은 등록 건을 정리한다.
--
-- 이 위치가 안전한 이유: v_remaining_links = 0 은 "이 caregiver가 어떤
-- 사례에도 연결되어 있지 않다"는 뜻이다. 정상 데이터라면 등록 건은 사례가
-- 지워질 때 위 1번(case_id 기준) 또는 cases의 ON DELETE CASCADE로 이미
-- 사라졌으므로 여기서 지울 것이 남지 않는다. 남아 있다면 사례 없이 떠도는
-- 불일치 행이므로 지우는 것이 맞다. 연결이 남은 caregiver(다른 정상 사례와
-- 공유)는 이 분기에 들어오지 않아 등록 이력이 보존된다.
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

revoke all on function reset_test_caregiver_cleanup(uuid, boolean) from public;


-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- 20260807090100_test_reset_functions.sql의 두 헬퍼 정의를 그대로 다시
-- 실행하면 이 migration 이전 상태로 돌아간다(그 파일 35~84행, 94~155행).
-- 공개 RPC 3종은 이 파일에서 건드리지 않았으므로 되돌릴 것이 없다.
