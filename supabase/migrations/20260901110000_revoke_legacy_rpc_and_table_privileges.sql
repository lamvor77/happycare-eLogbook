-- ============================================================================
-- 보안 정리 1차 — 브라우저 역할(anon/authenticated)의 불필요한 실행/테이블
-- 권한 제거.
-- [운영 DB 상태 — 2026-09-01] 적용 완료.
-- ============================================================================
-- 배경(2026-09-01 RLS/Auth 보안 감사 결과):
--
-- 이 앱의 간병인 인증은 Supabase Auth를 쓰지 않는다. 휴대폰 OTP로 본인을
-- 확인한 뒤 자체 발급 세션 쿠키(caregiver_sessions)를 쓰고, 모든 DB 접근은
-- Next.js 서버 라우트가 세션을 검증한 뒤 service_role로 수행한다
-- (lib/caregiver-auth.ts, lib/supabase-admin.ts). 브라우저가 Supabase DB나
-- Storage를 직접 호출하는 코드는 한 곳도 없다(전수 확인).
--
-- 즉 anon/authenticated 역할에 남아 있는 권한들은 이 앱이 쓰지 않는
-- 공격면이다. 관리자만 예외로 Supabase Auth(=authenticated)를 계속 쓰므로,
-- 관리자 조회에 실제로 필요한 권한은 건드리지 않는다.
--
-- 이 마이그레이션은 데이터를 지우거나 바꾸지 않는다. 권한만 회수한다.
--
-- *** 적용 순서 ***
-- 이 파일은 애플리케이션 코드와 의존성이 없어 언제 적용해도 된다. 다만
-- 파일 이름 순서를 실제 운영 순서와 맞추기 위해 마지막(11:00)에 두었다:
--   20260901090000 (공개 조회 RPC 추가)
--     -> 앱 배포
--   20260901100000 (qr_token 컬럼 권한 회수 — 배포 확인 게이트 있음)
--   20260901110000 (이 파일)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. 구형 v1 RPC의 브라우저 실행 권한 회수
-- ----------------------------------------------------------------------------
-- register_case / join_case / set_current_caregiver(각 v1)은 Supabase Auth
-- 시절에 만들어진 함수다. 현재 앱은 register_case_v3 / join_case_v3 /
-- set_current_caregiver_v2만 호출하며(전수 확인 결과 v1 호출 0건), 그
-- v2/v3들은 이미 public 실행 권한이 회수되어 service_role 경로로만 쓰인다.
--
-- 그런데 운영 DB에서 v1 3개는 anon/authenticated에 EXECUTE가 남아 있다.
-- 특히 join_case v1은 auth.uid()와 family_code만 요구하고 휴대폰 OTP를
-- 요구하지 않는다 — 현재 앱이 강제하는 본인 확인 단계를 건너뛰는 경로다.
-- Supabase 이메일 공개 가입이 켜져 있는 동안에는 누구나 authenticated가
-- 될 수 있으므로 실제로 도달 가능한 경로다.
--
-- 함수 자체는 지우지 않는다(과거 데이터/이력과의 연결을 임의로 끊지
-- 않는다). 브라우저 역할의 직접 실행만 막는다. PUBLIC에도 기본 EXECUTE가
-- 부여될 수 있으므로 PUBLIC까지 함께 회수한다. postgres/service_role의
-- 권한은 건드리지 않는다.
--
-- 시그니처를 정확히 적는다 — 이름만으로는 오버로드를 특정할 수 없다.

revoke all on function register_case(
  uuid, text, date, text, text, text, text, text, text, text, text,
  text, text, date, date, text, boolean, text, text, text
) from public, anon, authenticated;

revoke all on function join_case(text, text, text, text, text)
  from public, anon, authenticated;

revoke all on function set_current_caregiver(uuid, uuid)
  from public, anon, authenticated;


-- 시그니처를 손으로 적는 방식은 오타나 미처 몰랐던 오버로드가 있으면 조용히
-- 아무것도 회수하지 못한 채 지나간다. 회수가 실제로 끝났는지 여기서 확인하고,
-- 남아 있으면 트랜잭션 전체를 실패시킨다.
do $$
declare
  v_left text;
begin
  select string_agg(
           p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> '
             || coalesce(r.rolname, 'PUBLIC'),
           ', '
         )
    into v_left
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(p.proacl) ac
  left join pg_roles r on r.oid = ac.grantee
  where n.nspname = 'public'
    and p.proname in ('register_case', 'join_case', 'set_current_caregiver')
    and ac.privilege_type = 'EXECUTE'
    and coalesce(r.rolname, 'PUBLIC') in ('PUBLIC', 'anon', 'authenticated');

  if v_left is not null then
    raise exception
      '구형 RPC에 브라우저 실행 권한이 남아 있습니다(시그니처 불일치 또는 미처리 오버로드): %', v_left;
  end if;
end
$$;


-- ----------------------------------------------------------------------------
-- 2. 현재 사용 중인 테이블: 쓰지 않는 권한 회수
-- ----------------------------------------------------------------------------
-- Supabase에서 대시보드로 만든 테이블은 anon/authenticated에 ALL이 부여된
-- 상태로 시작한다. 기존 마이그레이션들이 select/insert/update/delete는
-- 정리했지만 TRUNCATE/TRIGGER/REFERENCES는 한 번도 다루지 않았다.
--
-- TRUNCATE를 특히 지운다: RLS가 적용되지 않는 명령이라 정책으로 막을 수
-- 없고, 테이블 전체를 비우는 파괴적 명령이다. 현재는 PostgREST가 TRUNCATE를
-- 노출하지 않아 anon 키만으로 도달할 수는 없지만, 방어를 그 한 가지에
-- 의존할 이유가 없다.
--
-- TRIGGER/REFERENCES는 이 앱의 어떤 경로에서도 쓰지 않는다(스키마 변경은
-- 마이그레이션으로만 한다).
--
-- 미래에 추가될 테이블까지 건드리는 동적 SQL을 쓰지 않고 대상을 명시한다.

revoke truncate, trigger, references on admin_audit_logs from anon, authenticated;
revoke truncate, trigger, references on admin_users from anon, authenticated;
revoke truncate, trigger, references on care_log_photos from anon, authenticated;
revoke truncate, trigger, references on care_logs from anon, authenticated;
revoke truncate, trigger, references on caregiver_otp_codes from anon, authenticated;
revoke truncate, trigger, references on caregiver_registrations from anon, authenticated;
revoke truncate, trigger, references on caregiver_sessions from anon, authenticated;
revoke truncate, trigger, references on caregivers from anon, authenticated;
revoke truncate, trigger, references on case_caregivers from anon, authenticated;
revoke truncate, trigger, references on case_consents from anon, authenticated;
revoke truncate, trigger, references on case_history from anon, authenticated;
revoke truncate, trigger, references on cases from anon, authenticated;
revoke truncate, trigger, references on hospitals from anon, authenticated;
revoke truncate, trigger, references on registration_no_counters from anon, authenticated;


-- ----------------------------------------------------------------------------
-- 3. 레거시 테이블: 브라우저 역할 접근 전면 차단
-- ----------------------------------------------------------------------------
-- audit_logs / patient_members / patients / qr_auth_logs / users 는 구
-- 데이터 모델의 잔재다. 현재 애플리케이션 코드에서 참조가 0건이고
-- (app/lib 전수 검색), 마이그레이션에서도 "삭제된 patients 테이블을
-- 참조하는 죽은 코드"라는 서술로만 등장한다.
--
-- 문제는 이 테이블들에 RLS가 꺼져 있고 anon 권한이 남아 있다는 점이다.
-- RLS가 없으면 정책으로 걸러지지 않으므로, 권한이 있는 한 anon 키로
-- PostgREST를 통해 그대로 읽힌다. 지금은 모두 0행이라 실제 노출은 없지만,
-- patients/users처럼 개인정보가 들어갈 수 있는 이름의 테이블이 "쓰면 즉시
-- 공개되는" 상태로 남아 있는 것 자체가 위험하다.
--
-- 이번에는 테이블을 DROP하지 않는다(정말 미사용인지 운영에서 한 번 더
-- 확인한 뒤 별도 작업으로 처리한다). 접근 권한만 회수한다.

revoke all on audit_logs from anon, authenticated;
revoke all on patient_members from anon, authenticated;
revoke all on patients from anon, authenticated;
revoke all on qr_auth_logs from anon, authenticated;
revoke all on users from anon, authenticated;


-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- 아래는 "이 마이그레이션 이전 상태로 되돌리는" 문장이다. 되돌릴 일이
-- 생긴다면 그 이유(어떤 기능이 깨졌는지)를 먼저 확인할 것 — 이 권한들은
-- 현재 앱이 사용하지 않는 것으로 확인된 것들이다.
--
-- grant execute on function register_case(
--   uuid, text, date, text, text, text, text, text, text, text, text,
--   text, text, date, date, text, boolean, text, text, text
-- ) to anon, authenticated;
-- grant execute on function join_case(text, text, text, text, text)
--   to anon, authenticated;
-- grant execute on function set_current_caregiver(uuid, uuid)
--   to anon, authenticated;
--
-- (테이블 권한 복구는 필요한 테이블/권한만 개별적으로 grant 할 것.
--  revoke 전 상태를 그대로 되살리는 문장은 의도적으로 적지 않는다 —
--  TRUNCATE를 다시 부여하는 일은 없어야 한다.)
