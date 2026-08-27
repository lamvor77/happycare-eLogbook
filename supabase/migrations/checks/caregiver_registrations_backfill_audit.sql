-- ============================================================================
-- caregiver_registrations backfill 사전 점검 — 읽기 전용
-- ============================================================================
-- 20260827090000_caregiver_registrations.sql을 적용하기 전/후에, 최초 등록
-- 건(registration_type='initial')을 backfill해도 되는지 판단하기 위한
-- 조회 전용 스크립트다.
--
-- 이 파일은 아무것도 INSERT/UPDATE/DELETE 하지 않는다. SELECT만 있다.
--
-- *** 개인정보 ***
-- 환자명/간병인명/연락처/주민등록번호/생년월일 등 개인정보 컬럼은 어떤
-- 쿼리에서도 조회하지 않는다. 건수와 식별자(case_id)만 본다. 이상치를
-- 확인할 때 나오는 case_id는 내부 UUID이며 그 자체로 개인정보가 아니지만,
-- 결과를 외부에 공유하지 말 것.
--
-- *** backfill 대상 판별 근거 ***
-- 최초 등록자는 case_caregivers.is_primary_caregiver = true 로 식별한다.
--   - register_case_v3의 신규 사례 분기가 최초 등록자에게만 true를 넣는다
--     (20260823090000_legacy_sync_field_map.sql 317줄).
--   - 같은 함수의 기존 사례 재사용 분기는 false를 넣는다(239줄).
--   - join_case_v2(가족간병인 참여)도 false를 넣는다
--     (20260804090100_caregiver_session_functions.sql 222줄).
-- 즉 true인 행은 "이 사례를 처음 등록한 사람" 하나여야 정상이다.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. 전체 규모 — 사례 수와 등록번호 보유 사례 수
-- ----------------------------------------------------------------------------
select
  count(*)                                            as cases_total,
  count(registration_no)                              as cases_with_registration_no,
  count(*) filter (where registration_no is null)     as cases_without_registration_no,
  count(*) filter (where source_type = 'hospital_qr') as cases_hospital_qr,
  count(*) filter (where source_type = 'google_form') as cases_google_form
from cases;


-- ----------------------------------------------------------------------------
-- 2. registration_no 중복 여부
-- ----------------------------------------------------------------------------
-- 신규 테이블은 registration_no에 UNIQUE를 걸므로, 여기서 중복이 나오면
-- backfill이 실패한다. 정상이면 0행이어야 한다.
select registration_no, count(*) as dup_count
from cases
where registration_no is not null
group by registration_no
having count(*) > 1
order by dup_count desc;


-- ----------------------------------------------------------------------------
-- 3. legacy_sync_status 분포
-- ----------------------------------------------------------------------------
-- backfill 시 그대로 옮길 값의 분포. null은 "연동 대상이 아니었던 사례"다.
select
  coalesce(legacy_sync_status, '(null)') as legacy_sync_status,
  count(*)                               as case_count
from cases
group by legacy_sync_status
order by case_count desc;


-- ----------------------------------------------------------------------------
-- 4. primary caregiver 매칭 가능 건수
-- ----------------------------------------------------------------------------
-- backfill 대상은 "registration_no가 있고 + primary caregiver가 정확히 1명"인
-- 사례다. 아래 세 숫자의 합이 cases_with_registration_no와 같아야 한다.
with primary_counts as (
  select
    c.case_id,
    (
      select count(*)
      from case_caregivers cc
      where cc.case_id = c.case_id
        and cc.is_primary_caregiver = true
    ) as primary_cnt
  from cases c
  where c.registration_no is not null
)
select
  count(*) filter (where primary_cnt = 1) as backfillable,
  count(*) filter (where primary_cnt = 0) as no_primary_caregiver,
  count(*) filter (where primary_cnt > 1) as multiple_primary_caregivers,
  count(*)                                as total_with_registration_no
from primary_counts;


-- ----------------------------------------------------------------------------
-- 5. 이상치 1 — primary caregiver가 없는 사례
-- ----------------------------------------------------------------------------
-- google_form으로 들어와 아직 간병인이 연결되지 않은 사례가 여기 해당한다
-- (관리자 화면의 "간병인 연결 필요" 배지와 같은 상태). 이런 사례는
-- 등록번호를 누구에게 귀속시킬지 알 수 없으므로 backfill에서 제외하고
-- 목록만 남긴다 — 임의로 아무 간병인에게 붙이지 않는다.
select
  c.case_id,
  c.source_type,
  c.registration_no,
  c.legacy_sync_status,
  (select count(*) from case_caregivers cc where cc.case_id = c.case_id) as linked_caregivers
from cases c
where c.registration_no is not null
  and not exists (
    select 1 from case_caregivers cc
    where cc.case_id = c.case_id
      and cc.is_primary_caregiver = true
  )
order by c.created_at desc;


-- ----------------------------------------------------------------------------
-- 6. 이상치 2 — primary caregiver가 2명 이상인 사례
-- ----------------------------------------------------------------------------
-- 현재 코드 경로상 생길 수 없는 상태다(한 사례에 true를 넣는 곳은
-- register_case_v3의 신규 사례 분기 한 곳뿐). 만약 나온다면 과거 수동
-- 데이터 조작이 있었다는 뜻이므로, backfill 전에 사람이 확인해야 한다.
select
  c.case_id,
  c.source_type,
  c.registration_no,
  count(cc.case_caregiver_id) as primary_count
from cases c
join case_caregivers cc
  on cc.case_id = c.case_id
 and cc.is_primary_caregiver = true
where c.registration_no is not null
group by c.case_id, c.source_type, c.registration_no
having count(cc.case_caregiver_id) > 1
order by primary_count desc;


-- ----------------------------------------------------------------------------
-- 7. 이상치 3 — primary caregiver가 '활성'이 아닌 사례
-- ----------------------------------------------------------------------------
-- 현재 코드에는 status를 '활성' 외의 값으로 바꾸는 경로가 없으므로 0행이
-- 정상이다. 0행이 아니면 status 값 체계에 대한 가정을 다시 검토해야 한다.
select
  cc.status,
  count(*) as cnt
from cases c
join case_caregivers cc
  on cc.case_id = c.case_id
 and cc.is_primary_caregiver = true
where c.registration_no is not null
group by cc.status
order by cnt desc;


-- ----------------------------------------------------------------------------
-- 8. 동의 기록 연결 가능 여부
-- ----------------------------------------------------------------------------
-- backfill 시 consent_id를 채울 수 있는지 확인한다. case_consents에는
-- UNIQUE(case_id, caregiver_id)가 없어 같은 조합이 여러 행일 수 있으므로,
-- 조합당 행 수 분포를 먼저 본다. 2 이상이 있으면 backfill에서 consent_id를
-- null로 두고(모호하므로 임의 선택하지 않음) 목록만 남긴다.
with pairs as (
  select
    cs.case_id,
    cs.caregiver_id,
    count(*) as consent_rows
  from case_consents cs
  group by cs.case_id, cs.caregiver_id
)
select
  consent_rows,
  count(*) as pair_count
from pairs
group by consent_rows
order by consent_rows;


-- ----------------------------------------------------------------------------
-- 9. backfill 예상 결과 미리보기 (INSERT 아님 — SELECT만)
-- ----------------------------------------------------------------------------
-- 실제 backfill migration이 만들 행을 그대로 미리 본다. 개인정보 컬럼은
-- 포함하지 않는다. 여기 나온 건수가 4번의 backfillable과 같아야 한다.
select
  c.case_id,
  cc.caregiver_id,
  c.registration_no,
  'initial'            as registration_type,
  cc.relationship,
  c.legacy_sync_status,
  c.legacy_synced_at,
  c.legacy_sync_error
from cases c
join case_caregivers cc
  on cc.case_id = c.case_id
 and cc.is_primary_caregiver = true
where c.registration_no is not null
  and (
    select count(*)
    from case_caregivers x
    where x.case_id = c.case_id
      and x.is_primary_caregiver = true
  ) = 1
order by c.created_at;
