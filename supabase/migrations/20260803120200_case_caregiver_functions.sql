-- ============================================================================
-- 현재 간병인 변경을 원자적으로 처리하는 RPC 함수
-- ============================================================================
-- 이 파일은 운영 DB에 자동 실행되지 않는다. 검토 후 수동 적용할 것.
--
-- 적용 전 체크리스트:
--   1. case_caregivers에 case_id별로 is_current_caregiver=true인 행이
--      2개 이상 존재하지 않는지 먼저 확인한다(아래 부분 유니크 인덱스 생성이
--      실패할 수 있음).
--        select case_id, count(*) from case_caregivers
--        where is_current_caregiver = true group by case_id having count(*) > 1;
--   2. 아래 함수는 SECURITY DEFINER로 RLS를 우회하므로 auth.uid() 검증 로직을
--      함부로 제거하지 말 것.
--   3. *** 하드 의존성 ***: 20260803120000_caregiver_auth_link.sql이 이
--      파일보다 먼저 적용되어 있어야 한다. 아래 함수 본문이
--      `caregivers.auth_user_id` 컬럼을 참조하는데, 이 컬럼은 000번
--      마이그레이션에서 추가된다. 000번을 먼저 적용하지 않으면 CREATE
--      FUNCTION 자체가 "column c.auth_user_id does not exist" 오류로
--      실패한다.
-- ============================================================================

-- 동시에 두 명이 "현재 간병인"이 되는 것을 DB 레벨에서 막는다.
create unique index if not exists uq_case_caregivers_one_current
  on case_caregivers (case_id)
  where is_current_caregiver = true;

create or replace function set_current_caregiver(
  p_case_id uuid,
  p_new_case_caregiver_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_requesting_caregiver_id uuid;
  v_target_case_id uuid;
  v_target_status text;
begin
  -- 요청자가 이 case의 현재 간병인인지 auth.uid() 기준으로 재검증한다.
  -- (애플리케이션 레이어에서 이미 확인했더라도, SECURITY DEFINER 함수는
  --  RLS를 우회하므로 여기서도 반드시 다시 검증해야 한다.)
  select cc.caregiver_id
    into v_requesting_caregiver_id
  from case_caregivers cc
  join caregivers c on c.caregiver_id = cc.caregiver_id
  where cc.case_id = p_case_id
    and cc.is_current_caregiver = true
    and cc.status = '활성'
    and c.auth_user_id = auth.uid()
  limit 1;

  if v_requesting_caregiver_id is null then
    raise exception 'not_current_caregiver' using errcode = '42501';
  end if;

  -- 변경 대상이 동일 case에 연결된 활성 간병인인지 확인한다.
  select case_id, status
    into v_target_case_id, v_target_status
  from case_caregivers
  where case_caregiver_id = p_new_case_caregiver_id;

  if v_target_case_id is null or v_target_case_id <> p_case_id then
    raise exception 'invalid_target_caregiver' using errcode = '22023';
  end if;

  if v_target_status <> '활성' then
    raise exception 'inactive_target_caregiver' using errcode = '22023';
  end if;

  -- 원자적 스왑: 기존 현재 간병인 해제 후 신규 지정.
  -- 함수 실행 전체가 하나의 트랜잭션이므로 중간에 실패하면 전부 롤백된다.
  update case_caregivers
    set is_current_caregiver = false
    where case_id = p_case_id
      and is_current_caregiver = true;

  update case_caregivers
    set is_current_caregiver = true
    where case_caregiver_id = p_new_case_caregiver_id;
end;
$$;

-- anon에는 실행 권한을 주지 않는다. 로그인한(authenticated) 사용자만 호출 가능.
revoke all on function set_current_caregiver(uuid, uuid) from public;
grant execute on function set_current_caregiver(uuid, uuid) to authenticated;

-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- drop function if exists set_current_caregiver(uuid, uuid);
-- drop index if exists uq_case_caregivers_one_current;
