-- ============================================================================
-- 간병인 주민등록번호(전체 13자리) 암호화 저장 컬럼 — 운영 DB에 자동
-- 실행하지 않는다.
-- ============================================================================
-- 배경: 가족간병인 등록 실무상 간병인 주민등록번호 전체 13자리가 필요하다.
-- 평문으로는 절대 저장하지 않고, 애플리케이션 서버(lib/
-- caregiver-resident-number.ts)에서 AES-256-GCM으로 암호화한 결과만
-- 저장한다. 기존 caregivers.resident_number(원문 컬럼, 레거시)는 이번
-- 마이그레이션에서 건드리지 않는다 — 신규 코드는 어떤 경우에도 이 컬럼에
-- insert/update하지 않는다(이미 docs/privacy-data-policy.md에 명시된
-- 원칙을 그대로 따름).
--
-- 이 파일은 supabase/migrations/20260806090100_case_consents.sql(register_
-- case_v3 RPC)보다 먼저 적용되어야 한다 — 그 RPC가 아래 컬럼들을 참조한다.
-- ============================================================================

alter table caregivers
  add column if not exists resident_number_ciphertext text,
  add column if not exists resident_number_iv text,
  add column if not exists resident_number_auth_tag text,
  add column if not exists resident_number_key_version integer;

-- resident_number_masked 컬럼은 20260803120000_caregiver_auth_link.sql에서
-- 이미 추가되어 있으므로 여기서 다시 만들지 않는다.

-- *** 컬럼 단위 접근 통제(중요) ***
-- 20260803120500_rls_policies.sql이 caregivers에 대해 authenticated 역할의
-- select 권한을 컬럼 화이트리스트로 명시적으로 좁혀 두었다(GRANT SELECT
-- (caregiver_id, caregiver_name, phone, phone_normalized, auth_user_id,
-- resident_number_masked, otp_verified_at, created_at)). Postgres의 컬럼
-- 단위 GRANT는 opt-in이므로, 위 4개 신규 컬럼(ciphertext/iv/auth_tag/
-- key_version)은 별도로 GRANT하지 않는 한 authenticated/anon 모두 접근할
-- 수 없다. 이 마이그레이션은 의도적으로 이 4개 컬럼에 대한 GRANT를
-- 추가하지 않는다 — service_role(lib/supabase-admin.ts)만 접근 가능해야
-- 하며, service_role은 GRANT/RLS를 전부 우회하므로 이것으로 충분하다.
-- 즉 "아무 것도 하지 않는 것"이 이 4개 컬럼에 대한 의도된 보호 조치다.

-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- alter table caregivers
--   drop column if exists resident_number_ciphertext,
--   drop column if exists resident_number_iv,
--   drop column if exists resident_number_auth_tag,
--   drop column if exists resident_number_key_version;
