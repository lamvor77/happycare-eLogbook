-- ============================================================================
-- 최초 등록 건을 caregiver_registrations로 backfill
-- ============================================================================
-- [운영 DB 상태 — 2026-08-27] 이 migration은 운영 DB에 적용 완료됐다.
-- 실행 결과 4행이 생성됐고(전부 registration_type='initial',
-- legacy_sync_status='synced', consent_id 채워짐), 건너뛴 사례는 0건이었다.
-- cases 원본은 변경되지 않았음을 적용 후 확인했다. 재실행하지 않는다 —
-- NOT EXISTS + ON CONFLICT DO NOTHING으로 재실행해도 안전하지만, 그럴
-- 이유가 없다.
--
-- *** 선행 조건 ***
-- 20260827090000_caregiver_registrations.sql이 먼저 적용되어 있어야 한다
-- (2026-08-27 적용 완료).
--
-- *** 목적 ***
-- 지금까지 사례 단위로만 있던 최초 등록 정보(cases.registration_no와
-- legacy_sync_*)를 등록 건 단위 테이블에 initial 레코드로 옮겨 담는다.
-- 이후 추가되는 가족간병인 등록 건(family_join)과 같은 테이블에서 함께
-- 다루기 위한 것이다.
--
-- *** 원본 데이터는 그대로 둔다 ***
-- cases.registration_no / legacy_sync_status / legacy_synced_at /
-- legacy_sync_error를 읽기만 하고 UPDATE하지 않는다. 이 시점 이후로도
-- 최초 등록 건의 진실은 여전히 cases 쪽이며(3단계에서 등록 건 단위로
-- 전환하기 전까지), 여기 만들어지는 initial 행은 읽기 전용 미러다 —
-- 쓰기 경로를 만들지 않으므로 자동으로 그렇게 유지된다.
--
-- *** 대상 판별 근거 ***
-- 최초 등록자는 case_caregivers.is_primary_caregiver = true 로 식별한다.
--   - register_case_v3 신규 사례 분기만 true를 넣는다
--     (20260823090000_legacy_sync_field_map.sql 317줄)
--   - 같은 함수의 기존 사례 재사용 분기는 false (239줄)
--   - join_case_v2(가족간병인 참여)도 false
--     (20260804090100_caregiver_session_functions.sql 222줄)
--
-- *** 운영 DB audit 결과 (2026-08-27, 적용 직전) ***
--   registration_no 보유 사례            : 4
--   primary 정확히 1명(backfillable)     : 4
--   primary 0명(skip 대상)               : 0
--   primary 2명 이상(이상치)             : 0
--   registration_no 중복                 : 0
--   legacy_sync_status                   : synced 4  (E260827-002의 false
--                                          timeout은 관리자 재전송으로
--                                          정상화 완료)
--   (case_id, caregiver_id)별 consent 행 : 전부 1행 (조합 4개)
-- 즉 이 파일은 4행을 만들고, skip되는 사례는 없을 것으로 예상된다.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- backfill
-- ----------------------------------------------------------------------------
-- 여러 번 실행해도 안전하다(idempotent):
--   - NOT EXISTS로 이미 만들어진 (case_id, caregiver_id) 조합을 건너뛴다.
--   - 그래도 동시 실행 등으로 새는 경우를 대비해 ON CONFLICT DO NOTHING을
--     함께 둔다(uq_caregiver_registrations_case_caregiver /
--     uq_caregiver_registrations_registration_no가 잡아준다).
with single_consent as (
  -- 조합당 동의 행이 정확히 1개인 경우에만 그 consent_id를 쓴다. 2개
  -- 이상이면 어느 것을 근거로 삼을지 알 수 없으므로 이 CTE에서 아예
  -- 제외되고, 아래 left join 결과가 null이 되어 consent_id를 비워둔다 —
  -- 임의로 하나를 고르지 않는다.
  -- count(*) = 1이 보장된 뒤라 array_agg의 첫 원소가 곧 그 유일한 행이다.
  select
    case_id,
    caregiver_id,
    (array_agg(consent_id))[1] as consent_id
  from case_consents
  group by case_id, caregiver_id
  having count(*) = 1
)
insert into caregiver_registrations (
  case_id,
  caregiver_id,
  registration_no,
  registration_type,
  relationship,
  consent_id,
  legacy_sync_status,
  legacy_synced_at,
  legacy_sync_error
)
select
  c.case_id,
  cc.caregiver_id,
  c.registration_no,
  'initial',
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
  -- primary가 정확히 1명인 사례만 옮긴다. 0명이면 등록번호를 누구에게
  -- 귀속시킬지 알 수 없고, 2명 이상이면 어느 쪽이 최초 등록자인지 알 수
  -- 없다 — 두 경우 모두 임의로 추론하지 않고 건너뛴다(적용 후 아래
  -- "적용 후 확인" 쿼리로 건너뛴 사례를 확인할 것).
  and (
    select count(*)
    from case_caregivers x
    where x.case_id = c.case_id
      and x.is_primary_caregiver = true
  ) = 1
  and not exists (
    select 1
    from caregiver_registrations r
    where r.case_id = c.case_id
      and r.caregiver_id = cc.caregiver_id
  )
on conflict do nothing;


-- ============================================================================
-- 적용 후 확인 (읽기 전용 — 필요할 때 따로 실행)
-- ============================================================================
-- 1) 만들어진 행 수와 상태 분포
-- select registration_type, legacy_sync_status, count(*)
-- from caregiver_registrations
-- group by registration_type, legacy_sync_status
-- order by 1, 2;
--
-- 2) cases와 1:1로 맞는지 (양쪽 건수가 같아야 정상)
-- select
--   (select count(*) from cases where registration_no is not null) as cases_with_reg_no,
--   (select count(*) from caregiver_registrations where registration_type = 'initial') as initial_rows;
--
-- 3) consent_id를 채우지 못한 행 (동의 행이 없거나 2개 이상이었던 조합)
-- select count(*) as initial_rows_without_consent
-- from caregiver_registrations
-- where registration_type = 'initial' and consent_id is null;
--
-- 4) backfill에서 건너뛴 사례 (primary 0명 또는 2명 이상)
-- select c.case_id, c.source_type,
--        (select count(*) from case_caregivers x
--          where x.case_id = c.case_id and x.is_primary_caregiver = true) as primary_cnt
-- from cases c
-- where c.registration_no is not null
--   and not exists (
--     select 1 from caregiver_registrations r where r.case_id = c.case_id
--   );


-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- 이 파일이 만든 행만 지운다. family_join 등록 건은 건드리지 않는다.
-- cases는 애초에 수정하지 않았으므로 되돌릴 것이 없다.
--
-- delete from caregiver_registrations where registration_type = 'initial';
