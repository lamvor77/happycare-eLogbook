-- ============================================================================
-- Hotfix: 운영 DB에서 누락된 cases.legacy_sync_status/legacy_synced_at/
-- legacy_sync_error 컬럼만 복구한다 — 운영 DB에 자동 실행하지 않는다.
-- ============================================================================
-- 배경: 운영 DB 조회 결과 cases.admission_status/insurance_company_other와
-- 그 CHECK 제약은 이미 정상 존재했지만, legacy_sync_status/
-- legacy_synced_at/legacy_sync_error 3개 컬럼은 누락되어 있었다. 그 결과
-- register_case_v3(33파라미터, 신규 사례 생성 분기)가 이 컬럼들을 참조하는
-- INSERT를 실행하면서 "column \"legacy_sync_status\" of relation \"cases\"
-- does not exist" 오류로 실패하고 있었다.
--
-- 이 세 컬럼과 CHECK 제약의 원래 정의는
-- 20260822090000_electronic_registration_no.sql "2. cases: 기존 시스템
-- 연동 상태 컬럼" 절(85~97줄)에 있다. 이 hotfix는 그 정의를 새로 설계하지
-- 않고 그대로 재사용한다 — data type/nullable/CHECK 허용값/제약 이름
-- 전부 원본과 동일하게 맞췄다. register_case_v3/generate_e_registration_no()/
-- registration_no_counters/admission_status/insurance_company_other는 이미
-- 정상 상태이므로 이 파일에서 전혀 건드리지 않는다.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- cases: 기존 시스템 연동 상태 컬럼
-- (20260822090000_electronic_registration_no.sql 85~97줄과 동일, 재설계
-- 없이 그대로 재사용 — data type/nullable/기본값 없음/CHECK 허용값 동일)
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

-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- alter table cases drop constraint if exists cases_legacy_sync_status_check;
-- alter table cases drop column if exists legacy_sync_status;
-- alter table cases drop column if exists legacy_synced_at;
-- alter table cases drop column if exists legacy_sync_error;
