-- ============================================================================
-- 긴급 — SECURITY DEFINER 함수의 브라우저 실행 권한 회수.
-- [운영 DB 상태 — 2026-09-01 적용 완료]
-- ============================================================================
-- 이 파일은 운영에 먼저 적용한 뒤 기록으로 남긴 것이다. 20260901110000을
-- 적용하고 검증하는 과정에서 발견한 문제라 단계 진행보다 조치를 앞세웠다.
--
-- *** 무엇이 문제였나 ***
-- public 스키마의 SECURITY DEFINER 함수 대부분에 anon/authenticated EXECUTE가
-- 남아 있었다. 그 중에는 다음이 포함된다.
--
--   reset_test_case / reset_test_case_data / reset_test_caregiver /
--   reset_test_caregiver_cleanup / reset_test_hospital
--     -> 사례·간병일지·사진·동의기록을 지우고, reset_test_hospital은
--        마지막에 hospitals 행까지 지운다.
--     -> 함수 안에 is_admin() 검사가 없다. 권한 검증은 앱 라우트의
--        requireAdminApi()만 하고, 함수는 호출자를 그대로 신뢰한다.
--     -> anon 키는 공개 값이고(NEXT_PUBLIC_...), reset_test_hospital에
--        필요한 hospital_id는 공개 QR 진입을 위해 anon이 읽을 수 있다.
--        즉 공개 키만으로 병원 하나를 통째로 지울 수 있는 상태였다.
--
--   register_case_v2/v3, join_case_v2/v3
--     -> 휴대폰 OTP를 자체 검증하지 않는다. 검증은 앱 라우트가 RPC 호출
--        "전에" consumeVerifiedOtp()로 한다. 직접 호출하면 인증 없이
--        간병인·사례·동의기록이 만들어지고, 심지어 otp_verified_at이
--        now()로 기록되어 검증된 것처럼 남는다.
--
--   set_current_caregiver_v2, generate_e_registration_no,
--   get_public_hospital(v1)
--
-- *** 왜 남아 있었나 ***
-- Supabase는 public 스키마에 만들어지는 함수에 default privileges로
-- anon/authenticated에 "명시적" EXECUTE를 부여한다. 기존 마이그레이션들이
-- 쓴 `revoke all on function ... from public`은 PUBLIC 의사 역할의 권한만
-- 지우므로 그 명시적 권한은 그대로 남는다.
--
-- 앞으로 create function 뒤에는 반드시 세 대상을 모두 회수할 것:
--   revoke all on function ... from public, anon, authenticated;
--
-- *** 남겨 둔 함수 ***
--   get_public_hospital_v2 : 비로그인 QR 진입에 필요하다(의도된 공개).
--   is_admin               : RLS 정책 식은 조회자의 권한으로 평가된다.
--                            authenticated가 실행할 수 없게 되면 관리자
--                            화면 전체가 깨진다.
--   my_case_ids            : 위와 같은 이유. anon에는 빈 결과/ null만
--   current_caregiver_id     돌려주므로 위험하지 않다.
--
-- *** 앱 영향 ***
-- 회수 대상 함수는 전부 서버 라우트가 service_role로 호출한다
-- (lib/supabase-admin.ts). service_role/postgres 권한은 건드리지 않았다.
--
-- *** 방식 ***
-- 시그니처를 손으로 옮겨 적으면 오타나 오버로드 누락 시 조용히 아무것도
-- 회수하지 못한다. 대상은 이름 목록으로 명시하고 회수는 OID(regprocedure)로
-- 수행한다 — 같은 이름의 오버로드가 있어도 모두 처리된다.
-- ============================================================================

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        -- 데이터를 삭제하는 함수
        'reset_test_case', 'reset_test_case_data',
        'reset_test_caregiver', 'reset_test_caregiver_cleanup',
        'reset_test_hospital',
        -- OTP를 건너뛰고 데이터를 만드는 함수
        'register_case_v2', 'register_case_v3',
        'join_case_v2', 'join_case_v3',
        'set_current_caregiver_v2',
        -- 기타
        'generate_e_registration_no',
        'get_public_hospital'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.fn);
    raise notice '회수: %', r.fn;
  end loop;
end
$$;


-- ----------------------------------------------------------------------------
-- 사후 검증 — 브라우저 역할이 실행할 수 있는 함수가 허용 목록뿐인지
-- ----------------------------------------------------------------------------
-- 남아 있으면 트랜잭션 전체를 실패시킨다. 허용 목록에 새 함수를 더할 때는
-- "왜 브라우저가 직접 실행해야 하는가"를 먼저 답할 수 있어야 한다.
do $$
declare
  v_left text;
begin
  select string_agg(distinct p.proname, ', ')
    into v_left
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(p.proacl) ac
  left join pg_roles r on r.oid = ac.grantee
  where n.nspname = 'public'
    and ac.privilege_type = 'EXECUTE'
    and coalesce(r.rolname, 'PUBLIC') in ('PUBLIC', 'anon', 'authenticated')
    and p.proname not in (
      'get_public_hospital_v2',
      'is_admin',
      'my_case_ids',
      'current_caregiver_id'
    );

  if v_left is not null then
    raise exception
      '브라우저 역할이 실행할 수 있는 함수가 허용 목록 밖에 남아 있습니다: %', v_left;
  end if;
end
$$;


-- ============================================================================
-- 후속 과제 (이 파일에서 처리하지 않음)
-- ============================================================================
-- 권한 회수는 방어선 하나일 뿐이고, reset_test_* 함수가 호출자를 검증하지
-- 않는 구조 자체는 그대로다. 함수 안에 is_admin() 검사를 넣을지는 별도로
-- 검토한다 — 넣는다면 service_role 호출 경로(앱의 관리자 API)가 어떻게
-- 통과할지 함께 설계해야 한다(service_role에는 auth.uid()가 없다).
--
-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- 되돌리지 않는다. 이 권한들은 어떤 정상 기능도 사용하지 않으며,
-- 되돌리는 것은 공개 키로 운영 데이터를 지울 수 있는 상태로 돌아가는 것이다.
-- 특정 함수의 실행 권한이 정말 필요해지면 그 함수 하나만, 이유를 남기고
-- 개별적으로 grant 할 것.
