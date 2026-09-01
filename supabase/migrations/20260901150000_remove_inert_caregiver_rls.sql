-- ============================================================================
-- 동작하지 않는 caregiver INSERT 정책 3개 제거.
-- [운영 DB 상태 — 2026-09-01] 적용 완료.
--   적용 후 확인: 제거 대상 3개 정책 0행(storage.objects 포함), care_logs는
--   SELECT+admin UPDATE만/care_log_photos는 SELECT만 남음(INSERT 정책 없음),
--   두 테이블 RLS enabled 유지, case_history_insert의 is_admin() 유지,
--   GRANT와 helper 함수 ACL 무변경. 그리고 간병인 OTP 로그인 -> 간병일지
--   작성 -> 사진 첨부 -> 조회 -> QA reset까지 실제 E2E로 service_role
--   경로가 정책 제거의 영향을 받지 않음을 확인했다.
-- ============================================================================
-- 이 앱의 간병인은 Supabase Auth를 쓰지 않는다. 휴대폰 OTP로 본인을 확인한
-- 뒤 자체 세션 쿠키를 쓰고, 모든 DB/Storage 접근은 Next.js 서버 라우트가
-- 세션을 검증한 뒤 service_role로 수행한다. service_role은 RLS를 우회하므로
-- 간병인 트래픽은 애초에 아래 정책들을 통과 대상으로 삼지 않는다.
--
-- 그런데 정책 조건은 auth.uid()에 의존한다. 간병인 요청에는 사용자 JWT가
-- 없어 current_caregiver_id()가 항상 null이고, 조건이 늘 거짓이 된다.
-- 즉 이 정책들은 "간병인을 허용하는 규칙"처럼 읽히지만 실제로는 아무도
-- 허용하지 않는다. 코드를 읽는 사람에게 "RLS가 막아 주고 있다"는 잘못된
-- 인상을 주고, 그 가정으로 서버 검증을 빠뜨리면 곧바로 사고가 된다.
--
-- *** 제거 대상 (INSERT 정책 3개) ***
-- 세 정책 모두 is_admin() 조건이 없어 caregiver 조건만으로 이루어져 있다.
-- 따라서 제거해도 관리자 경로에 영향이 없다.
--
--   care_logs.care_logs_insert_current_caregiver
--   care_log_photos.care_log_photos_insert
--   storage.objects.care_log_photos_storage_insert
--
-- 실제 쓰기 경로가 전부 service_role임을 코드로 확인했다:
--   care_logs        <- app/api/cases/[id]/care-logs/route.ts
--                       (requireCurrentCaregiverSession이 돌려주는 클라이언트
--                        = lib/caregiver-auth.ts의 service_role)
--   care_log_photos  <- app/api/cases/[id]/care-logs/[logId]/photos/route.ts
--   storage 업로드   <- 같은 라우트의 admin.storage (service_role)
-- 브라우저에서 DB/Storage를 직접 호출하는 코드는 0건이다(전수 재확인).
--
-- 제거 후에는 정책이 없는 상태가 되어 anon/authenticated의 INSERT가 기본
-- 거부된다 — 지금보다 넓어지지 않고 좁아진다.
--
-- *** 제거하지 않는 것 ***
-- 나머지 caregiver 조건은 전부 `... or is_admin()` 형태의 결합 정책이다.
-- 거짓인 항을 OR로 갖는 것은 `false or is_admin()` = `is_admin()`과 같아
-- 보안상 얻는 것이 없는 반면, 정책을 다시 쓰다 관리자 조회를 깨뜨릴 위험은
-- 실재한다. 이득 없는 변경으로 관리자 경로를 건드리지 않는다.
--
--   cases_select, cases_update_current_caregiver, case_caregivers_select,
--   caregivers_select, care_logs_select, care_log_photos_select,
--   case_consents_select, case_history_select, case_history_insert,
--   care_log_photos_storage_select
--
-- 특히 case_history_insert는 직전 작업(20260901140000)에서 관리자 조건을
-- 막 추가한 정책이다. 이번에 건드리지 않는다.
--
-- *** helper 함수 ***
-- current_caregiver_id()와 my_case_ids()는 제거 후에도 각각 1개/8개 정책이
-- 계속 사용한다. DROP 대상이 아니다. 둘 다 SECURITY DEFINER이지만
-- auth.uid() 기반이라 anon에는 null/빈 결과만 돌려주고, 실행 권한은 RLS
-- 정책 평가에 필요해 authenticated에 남겨 둔다(20260901120000의 허용 목록).
--
-- *** 이 마이그레이션이 하지 않는 것 ***
-- RLS 비활성화, GRANT 변경, 데이터 변경, 함수 DROP, 다른 정책 수정.
-- ============================================================================

drop policy if exists care_logs_insert_current_caregiver on care_logs;
drop policy if exists care_log_photos_insert on care_log_photos;
drop policy if exists care_log_photos_storage_insert on storage.objects;


-- ----------------------------------------------------------------------------
-- 사후 검증
-- ----------------------------------------------------------------------------
do $$
declare
  v_left text;
  v_missing text;
begin
  -- 1) 제거 대상이 실제로 사라졌는지
  select string_agg(pol.polname, ', ')
    into v_left
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  where pol.polname in (
    'care_logs_insert_current_caregiver',
    'care_log_photos_insert',
    'care_log_photos_storage_insert'
  );

  if v_left is not null then
    raise exception '제거되지 않은 정책이 있습니다: %', v_left;
  end if;

  -- 2) 관리자 경로가 의존하는 정책이 그대로 남아 있는지
  select string_agg(x.name, ', ')
    into v_missing
  from (values
    ('cases_select'), ('cases_update_current_caregiver'),
    ('case_caregivers_select'), ('caregivers_select'),
    ('care_logs_select'), ('care_logs_admin_soft_delete'),
    ('care_log_photos_select'), ('case_consents_select'),
    ('case_history_select'), ('case_history_insert'),
    ('caregiver_registrations_select'), ('admin_audit_logs_select'),
    ('hospitals_select_admin'), ('hospitals_admin_write'),
    ('hospitals_admin_update'), ('hospitals_admin_delete'),
    ('hospitals_select_active_public'),
    ('care_log_photos_storage_select')
  ) as x(name)
  where not exists (
    select 1 from pg_policy pol where pol.polname = x.name
  );

  if v_missing is not null then
    raise exception '유지되어야 할 정책이 사라졌습니다: %', v_missing;
  end if;

  -- 3) case_history_insert의 관리자 조건(20260901140000)이 훼손되지 않았는지
  if not exists (
    select 1
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    where c.relname = 'case_history'
      and pol.polname = 'case_history_insert'
      and pg_get_expr(pol.polwithcheck, pol.polrelid) like '%is_admin()%'
  ) then
    raise exception 'case_history_insert의 관리자 조건이 사라졌습니다.';
  end if;

  -- 4) 대상 테이블의 RLS가 켜진 상태로 남아 있는지
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('care_logs', 'care_log_photos')
      and not c.relrowsecurity
  ) then
    raise exception 'care_logs/care_log_photos의 RLS가 꺼져 있습니다.';
  end if;

  -- 5) 제거 대상 테이블에 예상 밖의 INSERT 정책이 생기지 않았는지
  if exists (
    select 1
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    where c.relname in ('care_logs', 'care_log_photos')
      and pol.polcmd = 'a'
  ) then
    raise exception 'care_logs/care_log_photos에 예상하지 않은 INSERT 정책이 있습니다.';
  end if;
end
$$;


-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- 되돌릴 이유는 "간병인이 브라우저에서 직접 INSERT해야 하는 경우"뿐인데,
-- 그것은 현재 아키텍처(서버 라우트 + service_role)를 되돌리는 결정이다.
-- 정책만 되살리면 auth.uid()가 없어 여전히 아무도 통과하지 못한다.
--
-- create policy care_logs_insert_current_caregiver on care_logs
--   for insert
--   with check (
--     caregiver_id = current_caregiver_id()
--     and case_id in (
--       select cc.case_id from case_caregivers cc
--       where cc.caregiver_id = current_caregiver_id()
--         and cc.is_current_caregiver = true
--         and cc.status = '활성'
--     )
--   );
--
-- create policy care_log_photos_insert on care_log_photos
--   for insert
--   with check (
--     log_id in (
--       select cl.log_id from care_logs cl
--       where cl.caregiver_id = current_caregiver_id()
--         and cl.case_id in (
--           select cc.case_id from case_caregivers cc
--           where cc.caregiver_id = current_caregiver_id()
--             and cc.is_current_caregiver = true
--             and cc.status = '활성'
--         )
--     )
--   );
--
-- create policy care_log_photos_storage_insert on storage.objects
--   for insert
--   with check (
--     bucket_id = 'care-log-photos'
--     and (storage.foldername(name))[1] in (
--       select cl.log_id::text from care_logs cl
--       where cl.caregiver_id = current_caregiver_id()
--         and cl.case_id in (
--           select cc.case_id from case_caregivers cc
--           where cc.caregiver_id = current_caregiver_id()
--             and cc.is_current_caregiver = true
--             and cc.status = '활성'
--         )
--     )
--   );
