-- ============================================================================
-- 주민등록번호 원문(resident_number) 정리 — 운영 DB에 자동 실행하지 않는다.
-- ============================================================================
-- 이 파일은 supabase/migrations/(순서 적용 대상)가 아니라 "manual" 폴더에
-- 별도로 둔다 — 신규 코드 배포와 무관하게, 운영 책임자의 개별 승인을 받은
-- 뒤 해당 단계만 골라 실행하는 절차이기 때문이다.
--
-- 배경: docs/privacy-data-policy.md 4절 "기존 평문 데이터 처리 계획" 참고.
-- 신규 등록/참여 코드(app/api/cases/register, app/api/cases/join)는 이미
-- resident_number(원문) 컬럼에 아무 값도 쓰지 않는다. 이 파일은 "그 전에
-- 이미 저장되어 있던" 원문 데이터를 정리하는 절차다.
--
-- *** 규칙 ***
--   - 이 파일 안의 어떤 SELECT도 주민등록번호 원문 값 자체를 출력하지
--     않는다(건수와 마스킹 완료 여부만 확인한다).
--   - 각 단계는 트랜잭션으로 감싸고, 실행 후 결과를 확인한 뒤 COMMIT할지
--     ROLLBACK할지 사람이 판단한다(자동 COMMIT하지 않는다).
--   - 3단계(원문 null 처리)와 4단계(컬럼 drop)는 데이터가 되돌릴 수 없게
--     사라지는 단계이므로 운영 책임자의 서면 승인 없이는 실행하지 않는다.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0단계. 현황 파악(읽기 전용, 몇 번이든 안전하게 재실행 가능)
-- ----------------------------------------------------------------------------

-- 원문을 보유한 caregiver 수(값 자체는 노출하지 않음)
select count(*) as caregivers_with_plaintext_resident_number
from caregivers
where resident_number is not null and resident_number <> '';

-- 그중 마스킹본이 아직 없는(백필 대상) 행 수
select count(*) as needs_masked_backfill
from caregivers
where resident_number is not null
  and resident_number <> ''
  and (resident_number_masked is null or resident_number_masked = '');

-- 원문 길이가 예상(13자리 숫자, 하이픈 제외)과 다른 이상 데이터 건수
-- (마스킹 변환 전에 데이터 형식을 먼저 파악하기 위함 — 값은 노출하지 않음)
select count(*) as unexpected_format_count
from caregivers
where resident_number is not null
  and resident_number <> ''
  and length(regexp_replace(resident_number, '[^0-9]', '', 'g')) <> 13;


-- ----------------------------------------------------------------------------
-- 1단계. resident_number_masked 백필 (트랜잭션, 기본은 ROLLBACK)
-- ----------------------------------------------------------------------------
-- 형식은 lib/resident-number.ts의 maskResidentNumberFront7()과 동일하게
-- 맞춘다: 앞 6자리 + '-' + 7번째 자리 + '******' (예: "900101-1******").
-- 0단계에서 unexpected_format_count가 0이 아니라면, 그 행들은 아래 WHERE
-- 조건(길이 13자리 가정)에 걸리지 않아 자동으로 건너뛰어지므로 별도로
-- 조사해야 한다.

begin;

  update caregivers
  set resident_number_masked =
    substring(regexp_replace(resident_number, '[^0-9]', '', 'g') from 1 for 6)
    || '-'
    || substring(regexp_replace(resident_number, '[^0-9]', '', 'g') from 7 for 1)
    || '******'
  where resident_number is not null
    and resident_number <> ''
    and (resident_number_masked is null or resident_number_masked = '')
    and length(regexp_replace(resident_number, '[^0-9]', '', 'g')) = 13;

  -- 백필 결과 검증(값 노출 없이 건수와 형식만 확인)
  select
    count(*) as masked_total,
    count(*) filter (
      where resident_number_masked ~ '^[0-9]{6}-[0-9]\*{6}$'
    ) as masked_format_ok
  from caregivers
  where resident_number is not null and resident_number <> '';

  -- 위 두 값(masked_total과 masked_format_ok)이 일치하는지 확인한 뒤에만
  -- 아래 COMMIT으로 바꿔서 실행한다. 일치하지 않으면 ROLLBACK 상태로 두고
  -- 원인(형식 이상 데이터 등)을 먼저 조사한다.
  -- commit;
  rollback;


-- ============================================================================
-- 아래 2, 3, 4단계는 운영 책임자의 서면 승인 후에만, 그리고 위 1단계가
-- 실제로 commit되어 resident_number_masked가 모두 채워진 뒤에만 진행한다.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 2단계. 원문 null 처리 전 최종 확인(읽기 전용)
-- ----------------------------------------------------------------------------
-- 이 값이 0이어야 3단계를 진행할 수 있다(마스킹되지 않은 원문이 남아있는
-- 상태에서 원문을 지우면 그 데이터의 마스킹 정보를 영영 잃는다).
select count(*) as still_missing_masked_value
from caregivers
where resident_number is not null
  and resident_number <> ''
  and (resident_number_masked is null or resident_number_masked = '');


-- ----------------------------------------------------------------------------
-- 3단계. 원문 null 처리 (트랜잭션, 기본은 ROLLBACK) — 운영 승인 필요
-- ----------------------------------------------------------------------------
begin;

  update caregivers
  set resident_number = null
  where resident_number is not null
    and resident_number <> ''
    and resident_number_masked is not null
    and resident_number_masked <> '';

  -- 검증: 원문이 남아있는데 마스킹도 없는 행이 여전히 있는지(있으면 안 됨)
  select count(*) as remaining_plaintext_without_masked
  from caregivers
  where resident_number is not null and resident_number <> '';

  -- 운영 책임자 승인 후에만 아래 주석을 풀어 commit한다.
  -- commit;
  rollback;


-- ----------------------------------------------------------------------------
-- 4단계. 원문 컬럼 자체를 제거 (기본 비활성화) — 별도 승인 필요
-- ----------------------------------------------------------------------------
-- 1~3단계가 완료되고 최소 1릴리스 주기 이상 문제가 없음을 확인한 뒤에만
-- 검토한다. 컬럼을 drop하면 되돌릴 수 없다(백업에서만 복구 가능).
--
-- alter table caregivers drop column if exists resident_number;
--
-- drop 대신 접근을 더 강하게 차단만 하고 싶다면(컬럼은 남기되 완전 비공개),
-- RLS 컬럼 권한에서 이미 authenticated/anon 모두 이 컬럼에 대한 select
-- 권한이 없다(supabase/migrations/20260803120500_rls_policies.sql 참고).
-- 즉 드롭하지 않아도 애플리케이션 경로로는 이미 조회 불가능한 상태다.


-- ============================================================================
-- ROLLBACK / 복구 메모
-- ============================================================================
-- - 1, 3단계는 트랜잭션이므로 commit하지 않는 한 즉시 되돌아간다(기본값).
-- - 4단계(컬럼 drop)를 실행했다면 사전 백업(docs/rls-rollout.md 1번,
--   docs/privacy-data-policy.md 4-1절)에서 복구해야 한다 — 이 SQL
--   파일만으로는 컬럼을 되살릴 수 없다.
