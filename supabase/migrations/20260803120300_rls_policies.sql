-- ============================================================================
-- RLS 정책 초안 (draft) — 운영 DB에 자동 실행하지 않는다.
-- ============================================================================
--
-- *** 적용 전 반드시 읽을 것 ***
--
-- 1) 이 파일을 적용하기 전에 아래 20260803120000_caregiver_auth_link.sql,
--    20260803120200_case_caregiver_functions.sql이 먼저 적용되어 있어야 한다
--    (auth_user_id, phone_normalized, set_current_caregiver 함수, 부분
--    유니크 인덱스 의존).
--
-- 2) *** 가장 중요한 주의사항 ***
--    현재 app/admin/** 페이지들은 로그인 세션이 바인딩되지 않은 anon
--    클라이언트(lib/supabase.ts)로 데이터를 조회한다. 이 RLS를 적용하면
--    관리자 자신도 auth.uid()가 없는 요청으로 간주되어 자기 정책에 막혀
--    아무 데이터도 못 보게 된다. 즉:
--
--      이 RLS를 적용하려면 app/admin/** 의 데이터 조회 코드를
--      lib/supabase.ts(anon) 대신 lib/supabase-server.ts
--      (로그인 세션 바인딩) 로 먼저 교체해야 한다.
--
--    이 교체는 이번 단계(3단계, 간병인 인증) 범위에 포함되어 있지 않으므로
--    별도 작업으로 진행할 것을 권장한다. docs/caregiver-auth.md의
--    "영향받는 경로" 절 참고.
--
-- 3) 아래 정책을 적용하면 깨지는 기존 anon 의존 경로 목록
--    (docs/caregiver-auth.md에도 동일 목록 정리):
--      - app/log/page.tsx                (hospitals, cases를 anon으로 조회)
--      - app/case-register/page.tsx      (hospitals 조회, caregivers/cases/
--                                          case_caregivers에 anon insert)
--      - app/case-join/page.tsx          (cases 조회, caregivers/
--                                          case_caregivers에 anon insert)
--      - app/cases/[id]/page.tsx 및 하위  (cases/case_caregivers/care_logs를
--        (care-logs, CaseHistory 등)      anon으로 조회 — "링크만 알면 열람"
--                                          방식이라 로그인 강제 시 UX 변경 필요)
--      - app/admin/**                    (2번 항목 참고)
--      - app/api/google-form-sync         (cases에 anon upsert)
--
--    위 경로들은 이 RLS 적용 전에 서버 라우트/서비스 롤 기반으로 먼저
--    전환해야 계속 동작한다. 이번 커밋에서는 SQL만 준비하고 실제 적용/코드
--    전환은 하지 않는다.
--
-- 4) 롤백: 각 섹션 하단에 해당 정책/함수의 DROP 문을 주석으로 남겨둔다.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. 관리자 판별: admin_users 테이블 (ADMIN_EMAILS 대체용)
-- ----------------------------------------------------------------------------
-- 현재 관리자 판별은 앱 코드에서 환경변수 ADMIN_EMAILS로 처리한다
-- (lib/admin-auth.ts). DB 정책(RLS)에서는 환경변수를 읽을 수 없으므로,
-- DB 레벨에서 관리자를 판별하려면 별도 테이블이 필요하다.
--
-- 이행 계획:
--   1단계(현재): ADMIN_EMAILS 환경변수 + lib/admin-auth.ts로 앱 레벨 인가만 수행.
--   2단계(권장, 이 테이블 도입): admin_users에 관리자 auth.users.id를 등록하고,
--     RLS 정책은 admin_users 기준으로 판단한다.
--   3단계(전환 완료 후): ADMIN_EMAILS는 백업/이중 확인 용도로만 남기거나 제거.
--     전환 기간에는 lib/admin-auth.ts가 "ADMIN_EMAILS에 있거나 admin_users에
--     있으면 관리자"로 동작하도록 완충 로직을 두는 것을 권장(이번 단계에서는
--     코드 변경 없음, 문서화만 진행).
create table if not exists admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

alter table admin_users enable row level security;

-- 본인 행만 조회 가능(목록 열람 금지). 등록/삭제는 Dashboard 또는
-- service_role 스크립트로만 수행하고, anon/authenticated insert/update/delete
-- 정책은 만들지 않는다(기본 거부).
create policy admin_users_self_select on admin_users
  for select
  using (user_id = auth.uid());

-- 관리자 여부 판별 헬퍼(SECURITY DEFINER: 호출자가 admin_users를 직접 읽을
-- 필요 없이 boolean만 얻도록 한다).
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from admin_users where user_id = auth.uid()
  );
$$;

revoke all on function is_admin() from public;
grant execute on function is_admin() to authenticated;

-- ROLLBACK:
-- drop function if exists is_admin();
-- drop policy if exists admin_users_self_select on admin_users;
-- drop table if exists admin_users;


-- ----------------------------------------------------------------------------
-- 0-1. 로그인 간병인 판별 헬퍼
-- ----------------------------------------------------------------------------
create or replace function current_caregiver_id()
returns uuid
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select caregiver_id from caregivers where auth_user_id = auth.uid();
$$;

revoke all on function current_caregiver_id() from public;
grant execute on function current_caregiver_id() to authenticated;

-- 로그인 caregiver가 연결된 case_id 목록 (case_caregivers 자기참조로 인한
-- RLS 재귀를 피하기 위해 SECURITY DEFINER 함수로 분리한다).
create or replace function my_case_ids()
returns setof uuid
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select case_id from case_caregivers where caregiver_id = current_caregiver_id();
$$;

revoke all on function my_case_ids() from public;
grant execute on function my_case_ids() to authenticated;

-- ROLLBACK:
-- drop function if exists my_case_ids();
-- drop function if exists current_caregiver_id();


-- ----------------------------------------------------------------------------
-- 1. caregivers
-- ----------------------------------------------------------------------------
alter table caregivers enable row level security;

-- 본인 행 또는 관리자만 조회 가능. anon 정책은 만들지 않는다(전면 차단).
create policy caregivers_select on caregivers
  for select
  using (auth_user_id = auth.uid() or is_admin());

-- 주민등록번호 원문(resident_number)은 어떤 역할에도 SELECT 권한을 주지
-- 않는다. 필요한 컬럼만 명시적으로 authenticated에 부여한다.
-- (참고: service_role은 기본적으로 RLS와 컬럼 권한을 모두 우회하므로
--  운영/배치 스크립트에서 원문이 필요하면 service_role로만 접근할 것.)
revoke select on caregivers from authenticated, anon;
grant select (
  caregiver_id,
  caregiver_name,
  phone,
  phone_normalized,
  auth_user_id,
  resident_number_masked,
  otp_verified_at,
  created_at
) on caregivers to authenticated;

-- insert/update 정책은 이번 단계에서 만들지 않는다(기본 거부).
-- case-register/case-join의 anon insert는 이 정책 적용 시 실패한다.
-- 서버 라우트(service_role 또는 authenticated 흐름)로 전환 후 별도 정책을
-- 추가할 것. 예시(전환 후 참고용, 지금은 미적용):
--
--   create policy caregivers_insert_self on caregivers
--     for insert
--     with check (auth_user_id = auth.uid());

-- ROLLBACK:
-- revoke select (...) on caregivers from authenticated;
-- drop policy if exists caregivers_select on caregivers;
-- alter table caregivers disable row level security;


-- ----------------------------------------------------------------------------
-- 2. cases
-- ----------------------------------------------------------------------------
alter table cases enable row level security;

create policy cases_select on cases
  for select
  using (case_id in (select my_case_ids()) or is_admin());

-- 간병종료(EndCareButton -> app/api/cases/[id]/end-care)는 이제
-- lib/supabase-server.ts(로그인 세션 바인딩)로 실행되므로, 아래 정책으로
-- "현재 간병인 본인"만 상태를 바꿀 수 있게 제한한다.
create policy cases_update_current_caregiver on cases
  for update
  using (
    case_id in (
      select cc.case_id
      from case_caregivers cc
      where cc.caregiver_id = current_caregiver_id()
        and cc.is_current_caregiver = true
        and cc.status = '활성'
    )
    or is_admin()
  );

-- insert 정책 없음(기본 거부). case-register/case-join/google-form-sync의
-- anon insert/upsert는 서버 라우트 + service_role 전환이 선행되어야 한다.

-- ROLLBACK:
-- drop policy if exists cases_update_current_caregiver on cases;
-- drop policy if exists cases_select on cases;
-- alter table cases disable row level security;


-- ----------------------------------------------------------------------------
-- 3. case_caregivers
-- ----------------------------------------------------------------------------
alter table case_caregivers enable row level security;

create policy case_caregivers_select on case_caregivers
  for select
  using (case_id in (select my_case_ids()) or is_admin());

-- 현재 간병인 변경은 반드시 set_current_caregiver() RPC(SECURITY DEFINER)를
-- 통해서만 수행한다. authenticated에게 직접 UPDATE 권한을 주지 않는다.
-- (RPC는 함수 소유자 권한으로 실행되므로 이 REVOKE와 무관하게 동작한다.)
revoke update on case_caregivers from authenticated, anon;

-- insert 정책 없음(기본 거부) — case-register/case-join 전환 필요(2번 참고).

-- ROLLBACK:
-- drop policy if exists case_caregivers_select on case_caregivers;
-- alter table case_caregivers disable row level security;


-- ----------------------------------------------------------------------------
-- 4. care_logs
-- ----------------------------------------------------------------------------
alter table care_logs enable row level security;

create policy care_logs_select on care_logs
  for select
  using (case_id in (select my_case_ids()) or is_admin());

-- "현재 간병인만 insert 가능"을 DB 레벨에서도 강제한다(app/api/cases/[id]/
-- care-logs 라우트가 requireCurrentCaregiver()로 이미 검증하지만, RLS로도
-- 이중 방어한다). caregiver_id 컬럼 위조도 함께 차단한다.
create policy care_logs_insert_current_caregiver on care_logs
  for insert
  with check (
    caregiver_id = current_caregiver_id()
    and case_id in (
      select cc.case_id
      from case_caregivers cc
      where cc.caregiver_id = current_caregiver_id()
        and cc.is_current_caregiver = true
        and cc.status = '활성'
    )
  );

-- update/delete 정책 없음 — 간병일지는 작성 후 수정/삭제 불가(감사 로그 성격).
-- 추후 관리자 정정 기능이 필요하면 별도 정책을 추가할 것.

-- ROLLBACK:
-- drop policy if exists care_logs_insert_current_caregiver on care_logs;
-- drop policy if exists care_logs_select on care_logs;
-- alter table care_logs disable row level security;


-- ----------------------------------------------------------------------------
-- 5. care_log_photos
-- ----------------------------------------------------------------------------
alter table care_log_photos enable row level security;

create policy care_log_photos_select on care_log_photos
  for select
  using (
    log_id in (
      select log_id from care_logs where case_id in (select my_case_ids())
    )
    or is_admin()
  );

create policy care_log_photos_insert on care_log_photos
  for insert
  with check (
    log_id in (
      select cl.log_id
      from care_logs cl
      where cl.caregiver_id = current_caregiver_id()
        and cl.case_id in (
          select cc.case_id
          from case_caregivers cc
          where cc.caregiver_id = current_caregiver_id()
            and cc.is_current_caregiver = true
            and cc.status = '활성'
        )
    )
  );

-- ROLLBACK:
-- drop policy if exists care_log_photos_insert on care_log_photos;
-- drop policy if exists care_log_photos_select on care_log_photos;
-- alter table care_log_photos disable row level security;


-- ----------------------------------------------------------------------------
-- 6. case_history
-- ----------------------------------------------------------------------------
alter table case_history enable row level security;

create policy case_history_select on case_history
  for select
  using (case_id in (select my_case_ids()) or is_admin());

create policy case_history_insert on case_history
  for insert
  with check (case_id in (select my_case_ids()));

-- update/delete 정책 없음(감사 로그는 불변).

-- ROLLBACK:
-- drop policy if exists case_history_insert on case_history;
-- drop policy if exists case_history_select on case_history;
-- alter table case_history disable row level security;


-- ----------------------------------------------------------------------------
-- 7. hospitals
-- ----------------------------------------------------------------------------
-- QR 스캔(app/log, app/case-register)은 로그인 없이 hospitals를 조회해야
-- 하므로 완전 차단할 수는 없다. 대신:
--   (a) 노출 컬럼을 최소한으로 컬럼 단위 GRANT로 제한하고,
--   (b) 행 단위로는 status='active'인 병원만 anon에 노출한다.
-- hospital_code/qr_token은 "알면 조회 가능"한 식별자로 취급하고(무작위
-- 추측이 어려운 길이/엔트로피를 가지도록 애플리케이션에서 보장할 것),
-- 계약금액 등 민감한 컬럼이 추가되면 이 컬럼 목록에서 반드시 제외한다.
alter table hospitals enable row level security;

create policy hospitals_select_active_public on hospitals
  for select
  using (status = 'active');

create policy hospitals_select_admin on hospitals
  for select
  using (is_admin());

revoke select on hospitals from anon, authenticated;
grant select (
  hospital_id,
  hospital_name,
  hospital_address,
  hospital_phone,
  hospital_code,
  qr_token,
  status
) on hospitals to anon, authenticated;

-- insert/update(병원 등록/수정/QR 재발급)는 관리자 전용이어야 한다.
-- 단, app/admin/** 이 지금은 anon 클라이언트로 쓰기 때문에(위 2번 항목),
-- 아래 정책은 admin 페이지가 인증 클라이언트로 전환된 뒤에만 의미가 있다.
create policy hospitals_admin_write on hospitals
  for all
  using (is_admin())
  with check (is_admin());

-- ROLLBACK:
-- drop policy if exists hospitals_admin_write on hospitals;
-- revoke select (...) on hospitals from anon, authenticated;
-- drop policy if exists hospitals_select_admin on hospitals;
-- drop policy if exists hospitals_select_active_public on hospitals;
-- alter table hospitals disable row level security;
