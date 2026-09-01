-- ============================================================================
-- 공개 병원 조회 RPC(get_public_hospital_v2) 추가.
-- [운영 DB 상태 — 2026-09-01] 적용 완료.
-- ============================================================================
-- 목적: 비로그인 QR 진입 경로가 hospitals 테이블을 직접 조회하지 않고 이
-- 함수만 쓰게 만든다. 그래야 다음 단계(20260901100000)에서 anon의 qr_token
-- 컬럼 SELECT 권한을 회수할 수 있다.
--
-- 왜 qr_token 권한을 회수해야 하나:
-- 현재 anon에는 hospitals의 qr_token 컬럼 SELECT 권한이 있다. QR 토큰은
-- "이 병원 링크를 아는 사람만 진입한다"는 전제의 값인데, anon 키로 활성
-- 병원 전체의 토큰을 열거할 수 있으면 그 전제가 성립하지 않는다.
--
-- 왜 컬럼 권한만 지우면 안 되고 이 함수가 필요한가:
-- PostgreSQL은 WHERE 절에서 컬럼을 참조할 때도 그 컬럼의 SELECT 권한을
-- 요구한다. 지금처럼 `.eq("qr_token", ...)`로 거르는 코드는 권한을 지우는
-- 순간 함께 깨진다. SECURITY DEFINER 함수 안에서 대조하면 토큰을 아는
-- 사람만 자기 병원 정보를 얻고, 토큰 자체는 밖으로 나오지 않는다.
--
-- 기존 get_public_hospital()과의 차이:
-- 기존 함수는 `status = 'active'`를 내부에서 걸러 비활성 병원을 아예
-- 반환하지 않는다. 그러면 호출부가 "등록되지 않은 병원"과 "계약이 종료된
-- 병원"을 구분할 수 없어 현재 /log 화면의 안내 문구가 하나로 합쳐진다.
-- 기존 동작을 그대로 유지하기 위해 status를 거르지 않고 그대로 돌려주는
-- v2를 둔다. 판단은 호출부가 지금처럼 한다.
--
-- 기존 get_public_hospital()은 남겨 둔다(현재 호출부는 없지만, 이미 배포된
-- 함수를 이번 작업에서 제거할 이유가 없다).
-- ============================================================================

create or replace function get_public_hospital_v2(
  p_qr_token text default null,
  p_hospital_code text default null
)
returns table (
  hospital_id uuid,
  hospital_name text,
  hospital_address text,
  status text
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select h.hospital_id, h.hospital_name, h.hospital_address, h.status
  from hospitals h
  where (p_qr_token is not null and h.qr_token = p_qr_token)
     or (p_hospital_code is not null and h.hospital_code = p_hospital_code)
  limit 1;
$$;

comment on function get_public_hospital_v2(text, text) is
  '비로그인 QR 진입용 공개 병원 조회. qr_token/hospital_code를 밖으로 내보내지 않는다. status는 호출부가 판단하도록 그대로 반환한다.';

-- 반환 컬럼에 qr_token/hospital_code/hospital_phone이 없다는 점이 이 함수의
-- 핵심이다. 토큰을 아는 사람만 조회할 수 있고, 조회 결과로 다른 병원의
-- 토큰을 알아낼 수는 없다.
revoke all on function get_public_hospital_v2(text, text) from public;
grant execute on function get_public_hospital_v2(text, text) to anon, authenticated;


-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- drop function if exists get_public_hospital_v2(text, text);
