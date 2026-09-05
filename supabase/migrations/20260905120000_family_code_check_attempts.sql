-- ============================================================================
-- 가족코드 사전 검증 시도 기록 테이블.  [운영 DB 상태 — 2026-09-05] 적용 완료.
-- ============================================================================
-- 목적
-- ----------------------------------------------------------------------------
-- 가족간병인 추가 화면이 OTP를 발송하기 전에 가족코드를 먼저 확인하도록
-- 바꾼다(lib/family-code.ts). 그런데 "이 코드가 유효한가"에 답하는 순간 그
-- 경로는 가족코드 조회 오라클이 된다.
--
-- 지금까지 코드 추측은 /api/cases/join을 통해서만 가능했고, 매 시도가 검증된
-- OTP를 하나 소비했다(번호당 하루 10건). 사전 검증에 아무 비용이 없으면 그
-- 제한이 사라지고, 유효한 가족코드 하나만 알아내면 본인 번호 OTP만으로 그
-- 사례의 가족간병인이 되어 환자 정보를 볼 수 있다.
--
-- 왜 기존 OTP rate limit을 재사용할 수 없나
-- ----------------------------------------------------------------------------
-- caregiver_otp_codes의 제한은 phone_normalized 기준이다. OTP 발송 "전"
-- 단계에서는 요청자가 그 번호를 소유했다는 증거가 없으므로, 아무 번호나
-- 바꿔 넣으면 번호 기준 제한은 즉시 무력해진다. 따라서 번호가 아니라
-- 요청자 기준의 시도 기록이 따로 필요하다.
--
-- 개인정보
-- ----------------------------------------------------------------------------
-- IP 원문을 저장하지 않는다. 서버 시크릿(CAREGIVER_SESSION_SECRET)으로 HMAC한
-- 값만 client_key에 남긴다 — 같은 요청자는 같은 키로 모이지만 저장된 값에서
-- IP를 되돌릴 수는 없다. 가족코드 값 자체도 저장하지 않는다(성공 여부만).
--
-- 이 마이그레이션이 하지 않는 것
-- ----------------------------------------------------------------------------
--   - 기존 테이블/RPC/정책을 건드리지 않는다.
--   - cases.family_code 형식이나 생성 방식을 바꾸지 않는다.
--   - join_case_v3를 바꾸지 않는다(최종 검증은 그대로 남는다).
--
-- 적용 순서 주의
-- ----------------------------------------------------------------------------
-- 애플리케이션 코드는 이 테이블이 없어도 동작한다 — 저장소를 읽지 못하면
-- 사전 검증을 건너뛰고 기존과 똑같이 OTP를 보낸다(제한 없는 오라클을 여는
-- 것보다 안전한 쪽). 따라서 배포 전/후 어느 쪽에 적용해도 장애가 나지
-- 않지만, 이 테이블을 만들기 전까지는 사전 차단이 동작하지 않는다.
-- ============================================================================

create table if not exists family_code_check_attempts (
  attempt_id  uuid primary key default gen_random_uuid(),
  -- HMAC-SHA256(요청자 IP). 원문 IP가 아니다.
  client_key  text not null,
  succeeded   boolean not null,
  created_at  timestamptz not null default now()
);

comment on table family_code_check_attempts is
  '가족코드 사전 검증 시도 기록(요청 제한용). IP 원문과 가족코드 값은 저장하지 않는다.';

comment on column family_code_check_attempts.client_key is
  'CAREGIVER_SESSION_SECRET으로 HMAC한 요청자 IP. 되돌릴 수 없다.';

-- 조회 패턴은 두 가지뿐이다: (client_key, succeeded=false, 최근 10분),
-- (client_key, 오늘). 하나의 인덱스로 둘 다 받는다.
create index if not exists idx_family_code_check_attempts_client_time
  on family_code_check_attempts (client_key, created_at desc);

-- ----------------------------------------------------------------------------
-- 권한: 서버(service_role)만 쓴다. 브라우저 역할에는 아무 권한도 주지 않는다.
-- REVOKE 대상에 anon/authenticated를 함께 적는 이유는, Supabase의 default
-- privileges가 이 두 역할에 "명시적" 권한을 부여하기 때문이다 — public만
-- 지우면 그 명시적 권한은 그대로 남는다.
-- ----------------------------------------------------------------------------
alter table family_code_check_attempts enable row level security;

revoke all on table family_code_check_attempts from public, anon, authenticated;

-- RLS를 켜고 정책을 하나도 만들지 않았으므로, 설령 권한이 새어 나가도
-- service_role(정책 우회) 외에는 어떤 행도 보이지 않는다.

-- ----------------------------------------------------------------------------
-- 사후 검증
-- ----------------------------------------------------------------------------
do $chk$
declare
  v_rls boolean;
  v_grantee text;
begin
  select relrowsecurity into v_rls
  from pg_class
  where oid = 'public.family_code_check_attempts'::regclass;

  if not coalesce(v_rls, false) then
    raise exception 'family_code_check_attempts에 RLS가 켜져 있지 않습니다.';
  end if;

  select string_agg(distinct grantee, ', ') into v_grantee
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'family_code_check_attempts'
    and grantee in ('anon', 'authenticated', 'PUBLIC');

  if v_grantee is not null then
    raise exception '브라우저 역할에 테이블 권한이 남아 있습니다: %', v_grantee;
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'family_code_check_attempts'
      and indexname = 'idx_family_code_check_attempts_client_time'
  ) then
    raise exception '조회 인덱스가 없습니다.';
  end if;
end;
$chk$;

-- ============================================================================
-- 보관 기간
-- ============================================================================
-- 이 표는 요청 제한에만 쓰이므로 오래된 행을 남길 이유가 없다. 자동 삭제를
-- 걸어두지는 않았다(pg_cron 도입 여부는 별도 결정). 필요할 때 아래를 수동
-- 실행한다.
--
--   delete from family_code_check_attempts where created_at < now() - interval '7 days';

-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- drop table if exists family_code_check_attempts;
