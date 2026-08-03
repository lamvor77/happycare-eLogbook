-- ============================================================================
-- RLS 정책 최종 후보 (v3) — 운영 DB에 자동 실행하지 않는다.
-- ============================================================================
--
-- *** 5단계 파일명 변경 안내 ***
-- 이 파일은 원래 20260803120300_rls_policies.sql 이었다. 타임스탬프상
-- 120300이 120400(registration_functions)보다 앞서 있어, 파일명 순서대로
-- 마이그레이션을 적용하는 도구(예: `supabase db push`)를 쓰면 이 RLS가
-- register_case()/join_case() RPC보다 먼저 적용되어 버리는 문제가 있었다
-- (SQL 문법상 하드 의존은 아니지만, RPC 없이 RLS부터 켜면 그 사이 기간
-- 동안 신규 등록/참여가 전부 막힌다). 그래서 5단계에서 실제 적용 순서와
-- 파일명이 일치하도록 120500으로 재명명했다. 내용은 4단계 버전과 이어지며
-- 이번에 몇 가지 항목을 보강했다(아래 "5단계 보강 사항" 참고).
--
-- *** 5단계 보강 사항 ***
--   - hospitals_admin_write 정책을 FOR ALL에서 FOR INSERT, UPDATE, DELETE로
--     좁혔다(SELECT는 이미 hospitals_select_active_public/
--     hospitals_select_admin이 담당하므로 FOR ALL은 불필요하게 넓었음).
--   - cases/case_caregivers/care_logs/case_history/care_log_photos에 대해
--     정책이 없는 명령(update/delete 등)도 명시적으로 REVOKE하여, RLS가
--     실수로 비활성화되는 등의 상황에서도 방어선이 남도록 했다(정책 부재
--     자체로도 기본 거부되지만, 이중 방어 차원).
--   - storage.objects 절의 주석을 정정했다: care-log-photos 업로드는 현재
--     app/api/cases/[id]/care-logs 에 구현되어 있지 않다(사진 첨부는 아직
--     신규 서버 플로우에 없는 기능). 실제로 이 버킷/테이블에 쓰는 코드는
--     레거시 app/care-log/[id]/page.tsx 뿐인데, 이 페이지는 이미 삭제된
--     patients 테이블을 참조하는 죽은 코드다(1단계 분석에서 삭제 권고,
--     아직 미삭제). 아래 storage 정책은 향후 사진 첨부 기능을 신규 플로우에
--     추가할 때를 대비한 선제적 정책이며, 현재는 강제되는 실사용 경로가
--     없다는 점을 명확히 해둔다. 레거시 페이지를 정리하기 전까지, 그
--     페이지는 anon 키로 직접 storage/care_log_photos에 쓰려고 시도할
--     것이고 이 RLS가 켜지면 (그 페이지가 caregiver 인증도 하지 않으므로)
--     정책을 통과하지 못해 결국 실패한다 — 이는 의도치 않은 부수 효과로
--     막히는 것이지, 설계된 보호는 아니다. 레거시 페이지 삭제를 별도로
--     권장한다.
--   - SECURITY DEFINER 헬퍼 함수(is_admin, current_caregiver_id,
--     my_case_ids, get_public_hospital)가 RLS 재귀 없이 동작하는 이유를
--     주석으로 명시했다(함수 소유자가 테이블 소유자/RLS 우회 권한을 가진
--     경우에만 안전 — 통상 Supabase SQL Editor에서 postgres 역할로 함수를
--     만들면 이 조건을 만족한다).
--
-- *** 이번 개정으로 해소된 이전 캐비어트 ***
--   - app/admin/** 전 경로가 requireAdmin()이 반환하는 인증 클라이언트
--     (lib/supabase-server.ts, 세션 쿠키 바인딩)를 사용하도록 전환됨.
--     따라서 admin_users + is_admin() 기반 정책이 실제로 admin 페이지에서도
--     통과한다(3단계 때는 admin 페이지가 anon 클라이언트를 썼기 때문에
--     이 RLS를 켜면 관리자 자신도 막히는 문제가 있었음 — 이제 해결됨).
--   - case-register/case-join이 더 이상 anon 클라이언트로 caregivers/cases/
--     case_caregivers에 직접 insert하지 않는다. 둘 다 register_case()/
--     join_case() SECURITY DEFINER RPC를 통해서만 데이터를 생성한다.
--     따라서 이 세 테이블에는 authenticated용 INSERT 정책을 별도로 열어줄
--     필요가 없다(전부 RPC 경유, 기본 거부 유지).
--   - google-form-sync는 시크릿 헤더 검증 통과 후 SUPABASE_SERVICE_ROLE_KEY
--     기반 관리자 클라이언트(lib/supabase-admin.ts)를 사용한다. service_role은
--     RLS를 완전히 우회하므로 이 라우트는 이 파일의 정책과 무관하게 계속
--     동작한다.
--   - app/log, app/case-register의 병원 조회는 app/api/hospitals/lookup
--     (또는 페이지 내 최소 컬럼 조회)로 이미 컬럼을 제한하고 있어 이 RLS의
--     컬럼 단위 GRANT와 일치한다.
--
-- *** 남아있는 선행 조건 ***
--   1. 아래 파일들이 이 파일보다 먼저 적용되어 있어야 한다:
--      20260803120000_caregiver_auth_link.sql
--      20260803120050_admin_users.sql
--      20260803120200_case_caregiver_functions.sql
--      20260803120400_registration_functions.sql
--   2. admin_users 테이블에 최소 1명 이상의 관리자 auth.users.id가 등록되어
--      있어야 한다(그렇지 않으면 이 RLS 적용 즉시 관리자 화면에서 아무
--      데이터도 보이지 않는다 — ADMIN_EMAILS만으로는 DB 정책을 통과할 수
--      없음).
--   3. 적용 전 반드시 supabase/migrations/checks/pre_rls_audit.sql을
--      staging에서 먼저 실행해 아래를 확인한다: auth_user_id 미연결
--      caregiver 수, 중복 현재간병인, null case_no/family_code, 원문
--      resident_number 보유 건수 등.
--   4. PostgreSQL은 CREATE POLICY IF NOT EXISTS를 지원하지 않으므로, 재실행
--      가능하도록 각 정책 생성 앞에 DROP POLICY IF EXISTS를 둔다.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. 관리자 판별: admin_users / is_admin()
-- ----------------------------------------------------------------------------
-- admin_users 테이블과 is_admin() 함수는 20260803120050_admin_users.sql에서
-- 생성한다(이 파일보다 먼저 적용됨). 여기서는 재정의하지 않는다.


-- ----------------------------------------------------------------------------
-- 0-1. 로그인 간병인 판별 헬퍼
-- ----------------------------------------------------------------------------
-- 아래 함수들은 SECURITY DEFINER + 내부에서 caregivers/case_caregivers를
-- 직접 SELECT한다. case_caregivers 자체에도 RLS가 걸려 있는데 my_case_ids()가
-- 그 테이블을 다시 읽으므로 재귀처럼 보일 수 있지만, SECURITY DEFINER 함수는
-- "함수 소유자"의 권한으로 실행되고, 이 마이그레이션을 Supabase SQL
-- Editor(postgres 역할, 테이블 소유자)로 적용하면 소유자는 기본적으로 RLS를
-- 우회하므로 실제로는 재귀도, 정책 재평가도 일어나지 않는다. 이 함수들을
-- 다른(테이블을 소유하지 않은/BYPASSRLS 권한이 없는) 역할로 재생성하면 이
-- 전제가 깨지므로 주의할 것.
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
-- 0-2. 공개 병원 QR 조회용 최소 함수(비로그인 사용)
-- ----------------------------------------------------------------------------
-- app/api/hospitals/lookup, app/log, app/case-register가 사용할 수 있는
-- 서버측 대안. 반환 컬럼을 최소화하고(hospital_code/전화번호 등 제외),
-- status='active'인 병원만 반환한다. search_path를 고정해 SECURITY DEFINER
-- 함수의 search_path 하이재킹을 방지한다.
create or replace function get_public_hospital(
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
  select hospital_id, hospital_name, hospital_address, status
  from hospitals
  where status = 'active'
    and (
      (p_qr_token is not null and qr_token = p_qr_token)
      or (p_hospital_code is not null and hospital_code = p_hospital_code)
    )
  limit 1;
$$;

revoke all on function get_public_hospital(text, text) from public;
grant execute on function get_public_hospital(text, text) to anon, authenticated;

-- ROLLBACK:
-- drop function if exists get_public_hospital(text, text);


-- ----------------------------------------------------------------------------
-- 1. caregivers
-- ----------------------------------------------------------------------------
alter table caregivers enable row level security;

drop policy if exists caregivers_select on caregivers;
create policy caregivers_select on caregivers
  for select
  using (auth_user_id = auth.uid() or is_admin());

-- 주민등록번호 원문(resident_number)은 어떤 역할에도 SELECT 권한을 주지
-- 않는다. resident_number_masked만 조회 가능하다.
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

-- insert/update 정책 없음(기본 거부) — 신규/기존 caregiver 행은 오직
-- register_case()/join_case() RPC(SECURITY DEFINER)를 통해서만 생성된다.
-- 정책이 없으면 RLS가 이미 기본 거부하지만, 실수로 그런 정책이 나중에
-- 추가되는 것을 막기 위해 GRANT 자체도 명시적으로 제거해 이중 방어한다.
revoke insert, update, delete on caregivers from anon, authenticated;

-- ROLLBACK:
-- revoke select (...) on caregivers from authenticated;
-- drop policy if exists caregivers_select on caregivers;
-- alter table caregivers disable row level security;


-- ----------------------------------------------------------------------------
-- 2. cases
-- ----------------------------------------------------------------------------
alter table cases enable row level security;

drop policy if exists cases_select on cases;
create policy cases_select on cases
  for select
  using (case_id in (select my_case_ids()) or is_admin());

-- 간병종료(app/api/cases/[id]/end-care)는 로그인 세션이 바인딩된 서버
-- 클라이언트로 실행되므로, "현재 간병인 본인" 또는 관리자만 상태를 바꿀 수
-- 있게 제한한다. 이 경로 외에 클라이언트가 cases를 직접 update하는 코드는
-- 없다(전수 확인됨).
drop policy if exists cases_update_current_caregiver on cases;
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

-- insert 정책 없음(기본 거부) — register_case() RPC 및 google-form-sync
-- (service_role, RLS 우회)를 통해서만 생성된다. delete는 애초에 지원하지
-- 않는 기능이므로 명시적으로도 막는다.
revoke insert, delete on cases from anon, authenticated;

-- ROLLBACK:
-- drop policy if exists cases_update_current_caregiver on cases;
-- drop policy if exists cases_select on cases;
-- alter table cases disable row level security;


-- ----------------------------------------------------------------------------
-- 3. case_caregivers
-- ----------------------------------------------------------------------------
alter table case_caregivers enable row level security;

drop policy if exists case_caregivers_select on case_caregivers;
create policy case_caregivers_select on case_caregivers
  for select
  using (case_id in (select my_case_ids()) or is_admin());

-- 현재 간병인 변경은 반드시 set_current_caregiver() RPC(SECURITY DEFINER)를
-- 통해서만 수행한다. authenticated에게 직접 UPDATE 권한을 주지 않는다.
-- insert/delete도 register_case()/join_case() RPC 경유로만 이뤄지므로
-- 함께 명시적으로 막는다.
revoke insert, update, delete on case_caregivers from authenticated, anon;

-- ROLLBACK:
-- drop policy if exists case_caregivers_select on case_caregivers;
-- alter table case_caregivers disable row level security;


-- ----------------------------------------------------------------------------
-- 4. care_logs
-- ----------------------------------------------------------------------------
alter table care_logs enable row level security;

drop policy if exists care_logs_select on care_logs;
create policy care_logs_select on care_logs
  for select
  using (case_id in (select my_case_ids()) or is_admin());

-- "현재 간병인만 insert 가능"을 DB 레벨에서도 강제한다(app/api/cases/[id]/
-- care-logs가 requireCurrentCaregiver()로 이미 검증하지만 이중 방어).
-- caregiver_id 컬럼 위조도 함께 차단한다.
drop policy if exists care_logs_insert_current_caregiver on care_logs;
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

-- update/delete 정책 없음 — 간병일지는 작성 후 수정/삭제 불가(감사 로그
-- 성격). 관리자 정정 기능이 필요해지면 별도 정책을 추가할 것. 정책 부재로
-- 이미 기본 거부되지만 GRANT 자체도 제거해 이중 방어한다.
revoke update, delete on care_logs from anon, authenticated;

-- ROLLBACK:
-- drop policy if exists care_logs_insert_current_caregiver on care_logs;
-- drop policy if exists care_logs_select on care_logs;
-- alter table care_logs disable row level security;


-- ----------------------------------------------------------------------------
-- 5. care_log_photos
-- ----------------------------------------------------------------------------
alter table care_log_photos enable row level security;

drop policy if exists care_log_photos_select on care_log_photos;
create policy care_log_photos_select on care_log_photos
  for select
  using (
    log_id in (
      select log_id from care_logs where case_id in (select my_case_ids())
    )
    or is_admin()
  );

drop policy if exists care_log_photos_insert on care_log_photos;
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

-- update/delete 정책 없음 — 증빙사진은 업로드 후 수정/삭제 불가.
revoke update, delete on care_log_photos from anon, authenticated;

-- ROLLBACK:
-- drop policy if exists care_log_photos_insert on care_log_photos;
-- drop policy if exists care_log_photos_select on care_log_photos;
-- alter table care_log_photos disable row level security;


-- ----------------------------------------------------------------------------
-- 6. case_history
-- ----------------------------------------------------------------------------
alter table case_history enable row level security;

drop policy if exists case_history_select on case_history;
create policy case_history_select on case_history
  for select
  using (case_id in (select my_case_ids()) or is_admin());

drop policy if exists case_history_insert on case_history;
create policy case_history_insert on case_history
  for insert
  with check (case_id in (select my_case_ids()));

-- update/delete 정책 없음(감사 로그는 불변).
revoke update, delete on case_history from anon, authenticated;

-- ROLLBACK:
-- drop policy if exists case_history_insert on case_history;
-- drop policy if exists case_history_select on case_history;
-- alter table case_history disable row level security;


-- ----------------------------------------------------------------------------
-- 7. hospitals
-- ----------------------------------------------------------------------------
alter table hospitals enable row level security;

drop policy if exists hospitals_select_active_public on hospitals;
create policy hospitals_select_active_public on hospitals
  for select
  using (status = 'active');

drop policy if exists hospitals_select_admin on hospitals;
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

-- 병원 등록/수정/QR 재발급은 app/api/admin/hospitals/** (requireAdminApi(),
-- 인증 클라이언트 사용)를 통해서만 수행되므로 이 정책으로 충분하다.
-- SELECT는 이미 위 두 정책이 담당하므로 FOR ALL 대신 쓰기 명령으로만
-- 좁힌다(불필요하게 넓은 권한 부여를 피함).
drop policy if exists hospitals_admin_write on hospitals;
create policy hospitals_admin_write on hospitals
  for insert
  with check (is_admin());

drop policy if exists hospitals_admin_update on hospitals;
create policy hospitals_admin_update on hospitals
  for update
  using (is_admin())
  with check (is_admin());

drop policy if exists hospitals_admin_delete on hospitals;
create policy hospitals_admin_delete on hospitals
  for delete
  using (is_admin());

-- ROLLBACK:
-- drop policy if exists hospitals_admin_delete on hospitals;
-- drop policy if exists hospitals_admin_update on hospitals;
-- drop policy if exists hospitals_admin_write on hospitals;
-- revoke select (...) on hospitals from anon, authenticated;
-- drop policy if exists hospitals_select_admin on hospitals;
-- drop policy if exists hospitals_select_active_public on hospitals;
-- alter table hospitals disable row level security;


-- ----------------------------------------------------------------------------
-- 8. storage.objects (care-log-photos 버킷)
-- ----------------------------------------------------------------------------
-- *** 현재 상태 ***: app/api/cases/[id]/care-logs (신규 서버 플로우)는
-- 사진 업로드를 구현하지 않았다 — 이 버킷/care_log_photos 테이블에 실제로
-- 쓰는 코드는 레거시 app/care-log/[id]/page.tsx뿐이며, 그 페이지는 이미
-- 삭제된 patients 테이블을 참조하는 죽은 코드다(별도 삭제 권장, 아직
-- 미삭제). 즉 아래 정책은 신규 플로우에 사진 첨부 기능이 추가될 때를 대비한
-- 선제적 정책이고, 지금 이 정책이 보호해야 할 실사용 쓰기 경로는 없다.
-- 레거시 페이지가 남아있는 동안에는 이 RLS가 (의도한 설계는 아니지만) 그
-- 페이지의 anon 업로드 시도를 함께 차단하는 부수 효과를 준다.
--
-- 업로드 경로 규칙(레거시 페이지 기준): `${log_id}/${timestamp}-${파일명}`.
-- storage.foldername(name)의 첫 번째 요소가 log_id 문자열이 된다. 신규
-- 플로우에서 사진 첨부를 구현할 때도 이 경로 규칙을 그대로 따르거나, 바꾼다면
-- 아래 정책도 함께 갱신할 것.
drop policy if exists care_log_photos_storage_select on storage.objects;
create policy care_log_photos_storage_select on storage.objects
  for select
  using (
    bucket_id = 'care-log-photos'
    and (
      is_admin()
      or (storage.foldername(name))[1] in (
        select log_id::text from care_logs where case_id in (select my_case_ids())
      )
    )
  );

-- 테이블 쪽 care_log_photos_insert 정책과 동일한 조건(현재 간병인 본인)으로
-- 맞춘다 — caregiver_id만 확인하고 is_current_caregiver/status를 확인하지
-- 않으면 테이블 정책보다 느슨해지므로 통일한다.
drop policy if exists care_log_photos_storage_insert on storage.objects;
create policy care_log_photos_storage_insert on storage.objects
  for insert
  with check (
    bucket_id = 'care-log-photos'
    and (storage.foldername(name))[1] in (
      select cl.log_id::text
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

-- update/delete 정책 없음 — 업로드된 증빙사진은 수정/삭제 불가.

-- ROLLBACK:
-- drop policy if exists care_log_photos_storage_insert on storage.objects;
-- drop policy if exists care_log_photos_storage_select on storage.objects;
