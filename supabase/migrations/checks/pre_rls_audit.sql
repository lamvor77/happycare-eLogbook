-- ============================================================================
-- RLS 적용 전 진단 스크립트 (읽기 전용) — staging에서 먼저 실행할 것.
-- ============================================================================
-- 아래 쿼리는 모두 SELECT만 수행하며 데이터를 변경하지 않는다. 그래도
-- 운영 DB에는 이 파일을 자동 실행하지 않는다 — Supabase SQL Editor 등에서
-- 결과를 직접 확인하며 실행할 것.
--
-- 각 섹션의 결과가 "0" 또는 "빈 목록"이 아니라면, RLS 적용 전에 먼저
-- 정리하거나 최소한 원인을 파악해야 한다. 10번(admin_users 등록 수)은
-- 20260803120050_admin_users.sql이 먼저 적용되어 있어야 실행할 수 있다
-- (그 전까지는 이 섹션만 건너뛰고 나머지를 먼저 확인해도 된다).
-- ============================================================================


-- 1) 테이블별 RLS 활성 여부
select
  schemaname,
  tablename,
  rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
  and tablename in (
    'hospitals', 'cases', 'caregivers', 'case_caregivers',
    'care_logs', 'care_log_photos', 'case_history', 'admin_users'
  )
order by tablename;


-- 2) 기존 policy 목록(중복/충돌 정책이 있는지 확인)
select
  schemaname,
  tablename,
  policyname,
  cmd,
  roles
from pg_policies
where schemaname in ('public', 'storage')
order by tablename, policyname;


-- 3) anon / authenticated 롤의 테이블 권한(GRANT) 현황
select
  table_schema,
  table_name,
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;


-- 3-1) anon이 개인정보 테이블에 갖고 있는 권한만 별도로 좁혀서 확인
--      (RLS 적용 후에는 이 목록에 caregivers/cases/case_caregivers/
--      care_logs/care_log_photos/case_history에 대한 anon 행이 전혀 없어야
--      하고, hospitals는 select만 남아 있어야 한다)
select
  table_name,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee = 'anon'
  and table_name in (
    'caregivers', 'cases', 'case_caregivers',
    'care_logs', 'care_log_photos', 'case_history', 'hospitals'
  )
order by table_name, privilege_type;


-- 4) case_id별 "현재 간병인"이 2명 이상인 경우(있으면 안 됨 — 있으면
--    uq_case_caregivers_one_current 부분 유니크 인덱스 생성이 실패한다)
select
  case_id,
  count(*) as current_caregiver_count
from case_caregivers
where is_current_caregiver = true
group by case_id
having count(*) > 1;


-- 4-1) 입원중(status='입원중')인데 현재 간병인이 0명인 case
--      (버그로 인한 데이터거나, set_current_caregiver 적용 전 과거 데이터일
--      수 있음 — 있어도 RLS 적용 자체를 막지는 않지만 기능상 문제이므로
--      확인 권장)
select c.case_id, c.case_no, c.patient_name
from cases c
where c.status = '입원중'
  and not exists (
    select 1 from case_caregivers cc
    where cc.case_id = c.case_id and cc.is_current_caregiver = true
  );


-- 5) auth_user_id가 아직 연결되지 않은 caregiver 수
--    (이 값이 크면, RLS 적용 즉시 해당 caregiver들은 로그인해도 자신의
--    caregivers 행/사례를 하나도 조회할 수 없다 — 사전에 연결 작업 필요)
select count(*) as caregivers_without_auth_user
from caregivers
where auth_user_id is null;


-- 5-1) auth_user_id 중복(같은 auth_user_id가 caregivers에 2행 이상)
--      정상적으로는 unique 제약으로 불가능해야 하지만, 000번 마이그레이션
--      적용 전이라면 아직 제약이 없을 수 있으므로 미리 확인한다.
select auth_user_id, count(*) as row_count
from caregivers
where auth_user_id is not null
group by auth_user_id
having count(*) > 1;


-- 5-2) phone_normalized 중복(중복 자체를 막는 제약은 없지만, 로그인 시
--      caregiver 매칭 로직이 여러 행과 매칭될 수 있어 확인이 필요하다)
select phone_normalized, count(*) as row_count
from caregivers
where phone_normalized is not null and phone_normalized <> ''
group by phone_normalized
having count(*) > 1;


-- 6) case_no 또는 family_code가 비어있는 사례 수
select count(*) as cases_missing_case_no_or_family_code
from cases
where case_no is null or case_no = ''
   or family_code is null or family_code = '';


-- 7) 주민등록번호 원문(resident_number)을 보유한 caregiver 수
--    (docs/privacy-data-policy.md의 마스킹 백필/삭제 절차 대상 규모 파악용.
--    이 쿼리는 건수만 세고 값 자체는 출력하지 않는다.)
select count(*) as caregivers_with_plaintext_resident_number
from caregivers
where resident_number is not null and resident_number <> '';


-- 8) 고아 관계 데이터: case_caregivers가 가리키는 case_id/caregiver_id가
--    실제로 존재하지 않는 경우(FK 제약이 있다면 정상적으로는 없어야 하지만,
--    제약이 없거나 과거에 우회 삽입된 데이터가 있을 수 있으므로 확인한다)
select cc.case_caregiver_id
from case_caregivers cc
left join cases c on c.case_id = cc.case_id
where c.case_id is null;

select cc.case_caregiver_id
from case_caregivers cc
left join caregivers cg on cg.caregiver_id = cc.caregiver_id
where cg.caregiver_id is null;


-- 8-1) 같은 case에 같은 caregiver가 두 번 이상 연결된 경우(중복 연결)
select case_id, caregiver_id, count(*) as row_count
from case_caregivers
group by case_id, caregiver_id
having count(*) > 1;


-- 9) care_logs가 가리키는 case_id가 존재하지 않는 경우(고아 care_logs)
select cl.log_id
from care_logs cl
left join cases c on c.case_id = cl.case_id
where c.case_id is null;


-- 9-1) care_log_photos가 가리키는 log_id가 존재하지 않는 경우(고아 사진)
select clp.*
from care_log_photos clp
left join care_logs cl on cl.log_id = clp.log_id
where cl.log_id is null;


-- 9-2) case_history가 가리키는 case_id가 존재하지 않는 경우(고아 이력)
select ch.history_id
from case_history ch
left join cases c on c.case_id = ch.case_id
where c.case_id is null;


-- 9-3) care_logs.location_status가 "checked"/"unavailable" 외의 값인 경우
--      (신규 코드는 이 두 값만 쓰지만, 과거 "not_used" 등 레거시 값이나
--      예상치 못한 값이 있을 수 있다 — RLS의 insert 정책과는 무관하지만
--      기존 데이터 점검 차원에서 확인)
select location_status, count(*) as row_count
from care_logs
group by location_status
having location_status not in ('checked', 'unavailable') or location_status is null;


-- 9-4) location_status='checked'인데 좌표가 비어있는 기록(데이터 정합성 문제)
select log_id, case_id, care_date
from care_logs
where location_status = 'checked'
  and (latitude is null or longitude is null);


-- 9-5) location_status='unavailable'인데 미기록 사유가 비어있는 기록
select log_id, case_id, care_date
from care_logs
where location_status = 'unavailable'
  and (location_failure_reason is null or location_failure_reason = '');


-- 9-6) 같은 case_id + care_date 조합으로 care_logs가 중복 작성된 경우
--      (있으면 안 됨 — 애플리케이션 레벨에서 하루 1건으로 제한하고 있음)
select case_id, care_date, count(*) as row_count
from care_logs
group by case_id, care_date
having count(*) > 1;


-- 10) admin_users 등록 현황(비어있으면 이 RLS 적용 시 관리자 화면이
--     아무 데이터도 못 보게 되므로 반드시 사전에 등록할 것)
-- 주의: 20260803120050_admin_users.sql이 아직 적용되지 않았다면 이 쿼리는
-- "relation admin_users does not exist" 오류가 난다 — 정상이다, 050번
-- 적용 후 다시 실행할 것.
select count(*) as admin_users_count from admin_users;
