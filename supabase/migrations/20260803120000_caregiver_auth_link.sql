-- ============================================================================
-- 간병인(caregivers) <-> Supabase Auth 연결 스키마
-- ============================================================================
-- 이 파일은 운영 DB에 자동 실행되지 않는다. Supabase SQL Editor 또는
-- `supabase db push` 등으로 검토 후 수동 적용할 것.
--
-- 적용 전 체크리스트:
--   1. caregivers.phone 컬럼의 실제 저장 형식을 확인한다(하이픈 유무, 국가번호 유무).
--   2. 아래 백필(UPDATE) 문은 한국 휴대폰번호("010...")를 가정한 예시이므로
--      실제 데이터 분포를 먼저 SELECT로 확인한 뒤 조정한다.
--   3. staging에서 먼저 적용하고 caregivers 행 수, phone_normalized 값 샘플을
--      확인한 뒤 운영에 적용한다.
--   4. 롤백은 아래 "ROLLBACK" 섹션 참고.
-- ============================================================================

-- caregiver_id PK는 그대로 유지한다. auth_user_id는 Supabase Auth의
-- auth.users(id)를 가리키는 선택적(nullable) 연결 컬럼이다.
-- nullable + unique 조합이므로 아직 연결되지 않은 caregiver는 여러 행이
-- auth_user_id = NULL 상태로 공존할 수 있다(Postgres는 NULL을 unique 제약에서
-- 중복으로 취급하지 않음).
alter table caregivers
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;

-- 로그인/연결 조회에 사용할 정규화된 전화번호(E.164, 예: +821012345678).
-- 기존 phone 컬럼은 그대로 두고(하위 호환), 조회용 컬럼을 별도로 둔다.
alter table caregivers
  add column if not exists phone_normalized text;

create index if not exists idx_caregivers_auth_user_id
  on caregivers (auth_user_id);

create index if not exists idx_caregivers_phone_normalized
  on caregivers (phone_normalized);

-- ----------------------------------------------------------------------------
-- 기존 데이터 백필 전략(주석, 실행 전 검토 필수)
-- ----------------------------------------------------------------------------
-- 아래는 "010-1234-5678", "01012345678" 등 한국 휴대폰번호 형식을
-- "+821012345678" 로 정규화하는 예시다. 실행 전 반드시 SELECT로 결과를
-- 미리 확인하라.
--
--   select phone,
--          '+82' || regexp_replace(regexp_replace(phone, '[^0-9]', '', 'g'), '^0', '')
--            as would_be_normalized
--   from caregivers
--   where phone_normalized is null;
--
-- 위 결과가 올바르면 아래 UPDATE를 실행한다.
--
--   update caregivers
--   set phone_normalized =
--     '+82' || regexp_replace(regexp_replace(phone, '[^0-9]', '', 'g'), '^0', '')
--   where phone_normalized is null
--     and phone is not null
--     and phone <> '';
--
-- ----------------------------------------------------------------------------
-- Supabase Auth 사용자와의 연결(auth_user_id 채우기) 전략
-- ----------------------------------------------------------------------------
-- 1) 기존 caregiver: 관리자가 Supabase Dashboard(Authentication > Users)에서
--    해당 전화번호로 Auth 사용자를 생성(또는 이미 존재하는 사용자를 확인)한 뒤
--    아래 형태의 UPDATE로 연결한다. auth.users.id는 Dashboard 또는
--    `select id, phone from auth.users where phone = '+821012345678';` 로 확인.
--
--   update caregivers
--   set auth_user_id = '<auth.users.id 값>'
--   where caregiver_id = '<caregivers.caregiver_id 값>';
--
-- 2) 신규 caregiver: 이번 단계에서는 case-register / case-join 등록 흐름 자체는
--    변경하지 않았으므로, 신규 가입 시 auth_user_id가 자동으로 채워지지 않는다.
--    운영 전 반드시 신규 가입자에 대한 연결 절차(수동 또는 별도 자동화)를
--    마련할 것. docs/caregiver-auth.md 참고.
--
-- ----------------------------------------------------------------------------
-- 주민등록번호 저장 정책
-- ----------------------------------------------------------------------------
-- 기존 resident_number(원문) 컬럼은 이번 단계에서 삭제하지 않는다(하위 호환).
-- 대신 마스킹된 표시용 컬럼을 추가한다. 마스킹 백필은 SQL이 아닌 애플리케이션
-- 스크립트로 수행할 것을 권장한다(SQL 세션 로그/쿼리 히스토리에 원문 주민등록
-- 번호가 남는 것을 피하기 위함).
alter table caregivers
  add column if not exists resident_number_masked text;

-- 권장 마스킹 형식 예시: 앞 6자리만 남기고 나머지는 * 처리
--   '901231' || repeat('*', greatest(length(resident_number) - 6, 0))
-- 이 변환은 이번 마이그레이션에서 실행하지 않는다. 원문 컬럼을 완전히
-- 제거하려면 별도 단계로 (1) 마스킹 백필 -> (2) 원문 컬럼 접근 코드 제거
-- -> (3) 원문 컬럼 drop 순서로 진행할 것을 권장한다.

-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- alter table caregivers drop column if exists auth_user_id;
-- alter table caregivers drop column if exists phone_normalized;
-- alter table caregivers drop column if exists resident_number_masked;
-- drop index if exists idx_caregivers_auth_user_id;
-- drop index if exists idx_caregivers_phone_normalized;
