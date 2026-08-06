-- ============================================================================
-- 기존 평문 주민등록번호(caregivers.resident_number) -> 암호화 컬럼 이행
-- 절차 — 운영 DB에 자동 실행하지 않는다.
-- ============================================================================
-- 이 파일은 supabase/migrations/(순서 적용 대상)가 아니라 "manual" 폴더에
-- 둔다 — supabase/migrations/manual/cleanup_resident_number.sql과 동일한
-- 이유다: 신규 코드 배포와 무관하게, 운영 책임자의 개별 승인을 받은 뒤
-- 별도로 실행하는 절차이기 때문이다.
--
-- *** 왜 이 파일에 "암호화 UPDATE" SQL이 없는가 ***
-- AES-256-GCM 암호화는 애플리케이션(Node.js, lib/caregiver-resident-number.ts)
-- 에서 수행한다. Supabase SQL Editor에서 원문을 다루는 UPDATE문을 작성하면
-- 그 원문이 SQL Editor 쿼리 히스토리/로그에 남을 위험이 있다(이미
-- docs/privacy-data-policy.md 4절, cleanup_resident_number.sql이 같은
-- 이유로 SQL 기반 원문 처리를 피하고 있다). 그래서 실제 암호화·백필은
-- 아래 "2단계"처럼 1회성 서버 스크립트로 수행하고 즉시 폐기하는 방식을
-- 권장한다. 이 SQL 파일은 값 자체를 노출하지 않는 읽기 전용 점검
-- 쿼리와, 이행 절차 문서만 담는다.
--
-- *** 선행 조건 ***
--   1. 20260806090000_encrypt_caregiver_resident_number.sql이 먼저
--      적용되어 있어야 한다(resident_number_ciphertext 등 컬럼 필요).
--   2. CAREGIVER_RRN_ENCRYPTION_KEY 환경변수가 이행 스크립트를 실행할
--      환경(운영자의 로컬 또는 신뢰할 수 있는 1회성 실행 환경)에 설정돼
--      있어야 한다 — 이 값을 커밋/문서/로그 어디에도 남기지 않는다.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0단계. 현황 파악(읽기 전용, 값 노출 없이 건수만 확인)
-- ----------------------------------------------------------------------------

-- 원문을 보유했지만 아직 암호화 컬럼이 없는 caregiver 수(이행 대상 규모)
select count(*) as needs_encryption_backfill
from caregivers
where resident_number is not null
  and resident_number <> ''
  and resident_number_ciphertext is null;

-- 원문 길이가 예상(13자리 숫자, 하이픈 제외)과 다른 이상 데이터 건수
select count(*) as unexpected_format_count
from caregivers
where resident_number is not null
  and resident_number <> ''
  and length(regexp_replace(resident_number, '[^0-9]', '', 'g')) <> 13;


-- ----------------------------------------------------------------------------
-- 1단계. 이행 대상 caregiver_id 목록만 추출(원문 값은 절대 포함하지 않음)
-- ----------------------------------------------------------------------------
-- 아래 결과(caregiver_id 목록)만 1회성 서버 스크립트에 전달한다. 이 쿼리
-- 결과를 파일로 저장/공유하지 말고, 스크립트가 매번 이 쿼리를 직접 실행해
-- 목록을 얻도록 구현할 것을 권장한다.
select caregiver_id
from caregivers
where resident_number is not null
  and resident_number <> ''
  and resident_number_ciphertext is null
  and length(regexp_replace(resident_number, '[^0-9]', '', 'g')) = 13;


-- ----------------------------------------------------------------------------
-- 2단계. (SQL 아님) 1회성 서버 스크립트로 암호화·백필 수행 — 운영 승인 필요
-- ----------------------------------------------------------------------------
-- 이 SQL 파일이 아니라, 아래 절차를 별도의 1회성 Node.js 스크립트로
-- 구현해서 실행하고 즉시 폐기할 것을 권장한다(이 리포지토리에는 포함하지
-- 않는다 — 원문을 다루는 스크립트를 커밋하면 git 히스토리에 로직/의도가
-- 영구히 남기 때문에, 실행 환경에서만 임시로 작성/실행/폐기).
--
--   1) service_role 클라이언트로 위 1단계 쿼리를 실행해 caregiver_id
--      목록을 가져온다.
--   2) 각 caregiver_id에 대해 caregivers.resident_number(원문)를
--      **service_role로만** 조회한다(RLS는 이미 이 컬럼에 대해
--      authenticated/anon 모두 select 권한이 없다).
--   3) lib/caregiver-resident-number.ts의 normalizeResidentNumber(),
--      encryptResidentNumber(), maskResidentNumber()를 그대로 재사용해
--      ciphertext/iv/auth_tag/key_version/masked를 계산한다(마스킹 형식이
--      기존 프론트 7자리 방식과 달라지지 않도록 동일 함수를 반드시
--      재사용할 것 — 새로 구현하지 않는다).
--   4) 아래 컬럼만 UPDATE한다(원문 resident_number는 이 단계에서
--      건드리지 않는다 — 3단계에서 별도로 처리):
--        resident_number_masked, resident_number_ciphertext,
--        resident_number_iv, resident_number_auth_tag,
--        resident_number_key_version
--   5) 스크립트 실행 로그에 caregiver_id와 성공/실패 여부만 남기고,
--      원문·암호문·키는 어떤 로그에도 남기지 않는다.
--   6) 스크립트 파일과 실행에 사용한 셸 히스토리를 즉시 삭제한다.


-- ----------------------------------------------------------------------------
-- 3단계. 백필 결과 검증(읽기 전용, 값 노출 없이 건수만 확인)
-- ----------------------------------------------------------------------------
select
  count(*) as total_with_plaintext,
  count(*) filter (where resident_number_ciphertext is not null) as encrypted_count,
  count(*) filter (
    where resident_number_ciphertext is not null
      and resident_number_masked ~ '^[0-9]{6}-[0-9]\*{6}$'
  ) as masked_format_ok
from caregivers
where resident_number is not null and resident_number <> '';

-- 위 total_with_plaintext == encrypted_count == masked_format_ok 가 모두
-- 일치해야 다음 단계(원문 정리)로 진행할 수 있다.


-- ----------------------------------------------------------------------------
-- 4단계. 원문 컬럼 정리 — 운영 책임자의 별도 서면 승인 필요, 기본 비활성화
-- ----------------------------------------------------------------------------
-- 3단계 검증이 100% 일치하고, 최소 1릴리스 주기 이상 문제가 없음을 확인한
-- 뒤에만 검토한다. 이 시점부터는 supabase/migrations/manual/
-- cleanup_resident_number.sql의 2~4단계와 절차가 합쳐진다 — 그 파일의
-- 나머지 단계(원문 null 처리, 컬럼 drop)를 그대로 따를 것. 이 파일에서는
-- 별도로 반복하지 않는다.

-- ============================================================================
-- 주의사항 요약
-- ============================================================================
-- - 이 파일의 어떤 SELECT/UPDATE도 주민등록번호 원문 값 자체를 출력하거나
--   SQL 리터럴로 포함하지 않는다.
-- - 2단계(실제 암호화)는 SQL이 아니라 1회성 서버 스크립트로 수행한다.
-- - CAREGIVER_RRN_ENCRYPTION_KEY는 이 파일이나 어떤 문서/커밋에도 값 자체를
--   남기지 않는다.
