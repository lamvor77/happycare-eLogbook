-- ============================================================================
-- hospitals: anon의 qr_token·hospital_code·hospital_phone 컬럼 SELECT 회수.
-- [운영 DB 상태 — 2026-09-01] 적용 완료(적용 후 anon 컬럼 4개 확인).
-- ============================================================================
-- *** 적용 순서 주의 — 이 파일에는 안전장치가 들어 있다 ***
-- 이 마이그레이션은 반드시 아래 두 가지가 먼저 끝난 뒤에 적용한다.
--   1) 20260901090000_public_hospital_lookup_rpc.sql 적용
--   2) get_public_hospital_v2를 쓰도록 바뀐 앱 코드 배포
--      (app/log/page.tsx, app/api/hospitals/lookup/route.ts,
--       app/api/cases/register/route.ts)
-- 순서를 지키지 않으면 QR 진입/등록이 "권한 없음"으로 실패한다.
--
-- 파일 이름의 타임스탬프 순서만으로는 "사이에 앱 배포가 있었다"를 보장할 수
-- 없다. 사람이 파일을 순서대로 실행하거나 도구가 일괄 적용하면 배포 단계가
-- 통째로 건너뛰어진다. 그래서 아래 1절에 실행 게이트를 둔다 — 배포를
-- 확인한 사람이 세션 변수를 직접 설정해야만 나머지 문장이 실행된다.
-- 일괄 적용 도구는 이 변수를 설정하지 않으므로 여기서 멈춘다.
--
-- 배경: 기존 정책은 hospitals의 SELECT를 회수한 뒤 필요한 컬럼만 다시
-- 부여했다(20260803120500_rls_policies.sql 7절). 그 목록에 qr_token과
-- hospital_code가 들어 있어, anon 키로 활성 병원 전체의 QR 토큰을 열거할
-- 수 있었다. 두 값 모두 이제는 get_public_hospital_v2 안에서만 대조되므로
-- 브라우저 역할이 직접 읽을 이유가 없다.
--
-- hospital_name/hospital_address는 계속 필요하다 — QR 진입 화면이 어느
-- 병원인지 보여준다. hospital_phone은 지금도 어떤 비로그인 화면에서도
-- 쓰지 않으므로 함께 제외한다.
--
-- authenticated는 건드리지 않는다. 근거(코드 추적 결과):
--   - app/admin/hospitals/page.tsx 와 app/api/admin/hospitals/[id]/route.ts 가
--     hospitals를 select("*")로 조회한다. 컬럼 하나라도 권한이 없으면 전체
--     조회가 권한 오류로 실패한다.
--   - 관리자 QR 화면(HospitalQrClient)은 /api/admin/hospitals/[id] 응답의
--     qr_token으로 QR URL을 만든다 — 이 컬럼이 실제로 필요하다.
--   - 이 화면들은 관리자 본인의 Supabase Auth 세션(=authenticated)으로
--     조회하므로, authenticated에서 컬럼을 빼면 곧바로 깨진다.
-- 컬럼 단위 GRANT는 역할 단위라 "관리자만" 부여할 수 없다. 행 수준 통제는
-- 기존 hospitals_select_admin 정책이 계속 담당한다.
--
-- *** 남는 위험(이번 범위 밖) ***
-- Supabase 이메일 공개 가입이 켜져 있는 동안에는 누구나 authenticated가 될
-- 수 있고, hospitals_select_active_public 정책이 status='active' 행을 모두
-- 허용하므로, 가입만 하면 qr_token을 여전히 읽을 수 있다. 즉 이 파일은
-- anon 경로만 막는다. 실질적으로 닫으려면 이메일 공개 가입을 꺼야 한다
-- (앱은 Supabase Auth 가입 기능을 쓰지 않는다 — signUp 호출 0건).
--   - anon          : 이름/주소/상태만
--   - authenticated : 기존 컬럼 유지(관리자 화면이 필요로 함)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. 실행 게이트 — 선행 조건 확인
-- ----------------------------------------------------------------------------
-- 실행하기 전에, 배포를 확인한 사람이 같은 SQL Editor 세션에서 아래 한 줄을
-- 먼저 실행해야 한다:
--
--   set local app.hospital_token_revoke_ack = 'deployed';
--
-- (트랜잭션 안에서 실행할 것 — SQL Editor는 한 번의 실행을 하나의 트랜잭션
--  으로 처리하므로, 위 문장을 이 파일 전체와 함께 실행하면 된다.)
do $$
begin
  if to_regprocedure('public.get_public_hospital_v2(text, text)') is null then
    raise exception
      '선행 마이그레이션이 없습니다: 20260901090000_public_hospital_lookup_rpc.sql를 먼저 적용하세요.';
  end if;

  if current_setting('app.hospital_token_revoke_ack', true) is distinct from 'deployed' then
    raise exception
      'get_public_hospital_v2를 사용하는 앱 배포가 끝난 뒤에만 적용할 수 있습니다. 배포를 확인했다면 같은 실행 안에서 먼저 다음을 실행하세요: set local app.hospital_token_revoke_ack = ''deployed'';';
  end if;
end
$$;


-- ----------------------------------------------------------------------------
-- 2. anon 컬럼 권한 축소
-- ----------------------------------------------------------------------------
-- anon: 공개 화면에 실제로 필요한 컬럼만 남긴다.
revoke select on hospitals from anon;

grant select (
  hospital_id,
  hospital_name,
  hospital_address,
  status
) on hospitals to anon;


-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- revoke select on hospitals from anon;
-- grant select (
--   hospital_id,
--   hospital_name,
--   hospital_address,
--   hospital_phone,
--   hospital_code,
--   qr_token,
--   status
-- ) on hospitals to anon;
