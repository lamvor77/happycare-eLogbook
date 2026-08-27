-- ============================================================================
-- backfill dry-run — 읽기 전용
-- ============================================================================
-- 20260827093000_backfill_initial_caregiver_registrations.sql을 실제로
-- 실행하기 전에, 그 INSERT가 만들 행을 미리 그대로 확인한다.
--
-- 아래 D2 쿼리는 그 migration의 INSERT ... SELECT 에서 INSERT 절만 떼어낸
-- 것이다 — WITH 절, JOIN, WHERE 조건이 전부 동일하다. 따라서 여기 나오는
-- 행이 곧 실제로 삽입될 행이다.
--
-- 이 파일은 아무것도 INSERT/UPDATE/DELETE 하지 않는다.
--
-- *** 개인정보 ***
-- 환자명/간병인명/연락처/주민등록번호/생년월일은 조회하지 않는다.
-- registration_no와 UUID는 업무 식별자이므로 결과를 외부에 공유하지 말 것.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- D1. 삽입될 행 수만 먼저 확인
-- ----------------------------------------------------------------------------
-- audit 기준 예상값: 4
with single_consent as (
  select case_id, caregiver_id, (array_agg(consent_id))[1] as consent_id
  from case_consents
  group by case_id, caregiver_id
  having count(*) = 1
)
select count(*) as rows_to_insert
from cases c
join case_caregivers cc
  on cc.case_id = c.case_id
 and cc.is_primary_caregiver = true
left join single_consent sc
  on sc.case_id = c.case_id
 and sc.caregiver_id = cc.caregiver_id
where c.registration_no is not null
  and (
    select count(*) from case_caregivers x
    where x.case_id = c.case_id and x.is_primary_caregiver = true
  ) = 1
  and not exists (
    select 1 from caregiver_registrations r
    where r.case_id = c.case_id and r.caregiver_id = cc.caregiver_id
  );


-- ----------------------------------------------------------------------------
-- D2. 삽입될 행의 실제 내용 (migration의 SELECT 절과 동일)
-- ----------------------------------------------------------------------------
-- 확인 포인트:
--   - registration_type이 전부 'initial'
--   - registration_no가 서로 중복되지 않음
--   - consent_id가 전부 채워짐(audit상 조합당 동의 1행이므로)
--   - legacy_sync_status가 전부 'synced'(E260827-002 정상화 이후)
with single_consent as (
  select case_id, caregiver_id, (array_agg(consent_id))[1] as consent_id
  from case_consents
  group by case_id, caregiver_id
  having count(*) = 1
)
select
  c.case_id,
  cc.caregiver_id,
  c.registration_no,
  'initial'              as registration_type,
  cc.relationship,
  sc.consent_id,
  c.legacy_sync_status,
  c.legacy_synced_at,
  c.legacy_sync_error
from cases c
join case_caregivers cc
  on cc.case_id = c.case_id
 and cc.is_primary_caregiver = true
left join single_consent sc
  on sc.case_id = c.case_id
 and sc.caregiver_id = cc.caregiver_id
where c.registration_no is not null
  and (
    select count(*) from case_caregivers x
    where x.case_id = c.case_id and x.is_primary_caregiver = true
  ) = 1
  and not exists (
    select 1 from caregiver_registrations r
    where r.case_id = c.case_id and r.caregiver_id = cc.caregiver_id
  )
order by c.registration_no;


-- ----------------------------------------------------------------------------
-- D3. 제약 위반 사전 점검
-- ----------------------------------------------------------------------------
-- 삽입될 registration_no가 이미 테이블에 있거나, 삽입 집합 안에서 서로
-- 중복되면 UNIQUE 제약에 걸린다. 정상이면 0행이다.
with candidates as (
  select c.registration_no
  from cases c
  join case_caregivers cc
    on cc.case_id = c.case_id
   and cc.is_primary_caregiver = true
  where c.registration_no is not null
    and (
      select count(*) from case_caregivers x
      where x.case_id = c.case_id and x.is_primary_caregiver = true
    ) = 1
    and not exists (
      select 1 from caregiver_registrations r
      where r.case_id = c.case_id and r.caregiver_id = cc.caregiver_id
    )
)
select 'duplicate_within_batch' as issue, registration_no, count(*) as cnt
from candidates
group by registration_no
having count(*) > 1
union all
select 'already_in_table', cand.registration_no, 1
from candidates cand
join caregiver_registrations r on r.registration_no = cand.registration_no;


-- ----------------------------------------------------------------------------
-- D4. 건너뛰게 될 사례 (primary 0명 또는 2명 이상)
-- ----------------------------------------------------------------------------
-- audit 기준 예상값: 0행
select
  c.case_id,
  c.source_type,
  (select count(*) from case_caregivers x
    where x.case_id = c.case_id and x.is_primary_caregiver = true) as primary_cnt
from cases c
where c.registration_no is not null
  and (
    select count(*) from case_caregivers x
    where x.case_id = c.case_id and x.is_primary_caregiver = true
  ) <> 1
order by primary_cnt desc;


-- ----------------------------------------------------------------------------
-- D5. 현재 테이블 상태 (실행 전 기준선)
-- ----------------------------------------------------------------------------
select
  count(*)                                                as total_rows,
  count(*) filter (where registration_type = 'initial')   as initial_rows,
  count(*) filter (where registration_type = 'family_join') as family_join_rows
from caregiver_registrations;
