-- ============================================================================
-- caregiver_registrations — "간병인 등록 건" 테이블
-- ============================================================================
-- [운영 DB 상태 — 2026-08-27] 이 migration은 운영 DB에 적용 완료됐다.
-- 적용 직후 읽기 전용 검증으로 테이블/컬럼 11개/CHECK 2개/FK 3개/인덱스
-- 4개/RLS 활성화/SELECT 정책(is_admin())/anon·authenticated 쓰기 권한
-- 없음까지 모두 확인했다. 재실행하지 않는다 — 모든 구문에 if not exists
-- 가드가 있어 재실행해도 안전하지만, 그럴 이유가 없다.
--
-- 적용 전 backfill 대상 분포는 checks/caregiver_registrations_backfill_
-- audit.sql로 먼저 확인했다(결과는 그 파일 헤더 참고).
--
-- *** 목적 ***
-- 지금까지 "등록번호"는 사례당 하나(cases.registration_no)뿐이었다. 앞으로
-- 가족간병인이 추가로 참여할 때마다 각자 별도의 E등록번호를 받고, 기존
-- 가족간병관리 Google Sheet에도 간병인마다 별도 행으로 들어가야 한다.
-- 사례 1건에 등록 건이 여러 개 달릴 수 있으므로, 그 등록 건을 담을 테이블을
-- 따로 만든다.
--
-- *** cases.registration_no를 재사용하지 않는 이유 ***
-- 그 컬럼은 이미 다른 계약에 묶여 있다 — app/api/google-form-sync/route.ts가
-- `onConflict: "registration_no"`로 upsert하는 키다(Google Form -> 앱 방향
-- 동기화). 여기에 간병인별 번호를 넣거나 의미를 바꾸면 역방향 동기화가
-- 깨진다. 그래서 cases.registration_no는 "이 사례의 최초 등록 건 번호"라는
-- 현재 의미 그대로 두고, 이 파일에서는 읽지도 쓰지도 않는다.
--
-- *** 이 파일이 하지 않는 것 ***
-- - cases / case_caregivers / case_consents / caregivers 를 ALTER 하지 않는다.
-- - generate_e_registration_no() 를 수정하지 않는다(그대로 재사용한다).
-- - backfill 하지 않는다(별도 migration으로 분리 — 10절 참고).
-- - 기존 최초 등록 sync 경로(lib/legacy-sync.ts)를 건드리지 않는다.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------
create table if not exists caregiver_registrations (
  registration_id uuid primary key default gen_random_uuid(),

  case_id uuid not null references cases(case_id) on delete cascade,
  caregiver_id uuid not null references caregivers(caregiver_id),

  -- generate_e_registration_no()가 발급한 값(E{YYMMDD}-{NNN}). 이 테이블이
  -- 직접 채번하지 않고, 호출부(RPC)가 그 함수를 호출해 받은 값을 넣는다.
  registration_no text not null,

  -- initial     : 최초 사례 등록과 함께 만들어진 등록 건
  -- family_join : 가족코드로 뒤늦게 참여한 간병인의 등록 건
  registration_type text not null,

  -- 등록 "당시"의 환자와의 관계 스냅샷. case_caregivers.relationship이
  -- 나중에 바뀌더라도 Sheet로 이미 나간 값과 어긋나지 않도록 여기 따로
  -- 남긴다.
  relationship text,

  -- 이 등록 건이 근거로 삼은 동의 기록. case_consents에는 아직
  -- UNIQUE(case_id, caregiver_id)가 없어 같은 조합으로 여러 행이 생길 수
  -- 있으므로, "어느 동의로 등록했는지"를 case_id+caregiver_id 조회에
  -- 맡기지 않고 명시적으로 가리킨다. 동의 기록이 없는 과거 데이터
  -- (google_form 유입 등)를 backfill할 수 있어야 하므로 nullable이다.
  consent_id uuid references case_consents(consent_id),

  -- 이 등록 건 하나에 대한 Sheet 전송 상태. 사례 단위가 아니라 등록 건
  -- 단위로 관리해야 간병인 A는 synced, B는 failed 같은 상태를 표현할 수
  -- 있다. 값 체계와 의미는 cases.legacy_sync_* 와 동일하게 맞춘다.
  legacy_sync_status text,
  legacy_synced_at timestamptz,
  legacy_sync_error text,

  created_at timestamptz not null default now()
);


-- ----------------------------------------------------------------------------
-- 2. CHECK 제약
-- ----------------------------------------------------------------------------
-- 허용값은 cases.legacy_sync_status의 CHECK(20260824091000_restore_legacy_
-- sync_columns.sql 43줄)와 정확히 같은 집합으로 맞춘다 — 두 곳의 상태값이
-- 갈리면 관리자 화면이 한쪽만 이해하게 된다.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'caregiver_registrations_legacy_sync_status_check'
  ) then
    alter table caregiver_registrations
      add constraint caregiver_registrations_legacy_sync_status_check
      check (
        legacy_sync_status is null
        or legacy_sync_status in ('pending', 'synced', 'failed')
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'caregiver_registrations_type_check'
  ) then
    alter table caregiver_registrations
      add constraint caregiver_registrations_type_check
      check (registration_type in ('initial', 'family_join'));
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 3. 유니크 제약 / 인덱스
-- ----------------------------------------------------------------------------
-- 등록번호는 전역 유일해야 한다 — Sheet의 "등록번호" 컬럼이 행을 식별하는
-- 키이고, Apps Script의 중복 방지도 이 값 하나만 본다.
create unique index if not exists uq_caregiver_registrations_registration_no
  on caregiver_registrations (registration_no);

-- 같은 사례에 같은 간병인의 등록 건이 두 번 생기는 것을 DB에서 막는다.
--
-- 이 제약이 필요한 이유: 중복이 생기면 서로 다른 E등록번호 두 개가 발급되고,
-- Apps Script는 등록번호 기준으로만 중복을 판단하므로 그 둘을 별개 등록으로
-- 보고 Sheet에 행을 두 개 만든다 — 즉 애플리케이션 레벨 확인만으로는
-- (동시 요청 시) 막을 수 없고, Sheet 쪽 안전장치도 이 경우를 잡아주지
-- 못한다. 그래서 DB 제약이 유일한 방어선이다.
--
-- 재참여 가능성 검토(2026-08-27): 현재 코드에는 case_caregivers.status를
-- '활성' 외의 값으로 바꾸는 경로가 전혀 없다("비활성"/"종료" 문자열이 앱과
-- migration 어디에도 없음). 즉 간병인이 사례에서 빠졌다가 다시 참여하는
-- 업무 흐름 자체가 아직 존재하지 않으므로, 이 제약이 지금 막고 있는 것은
-- "같은 사람의 중복 등록"뿐이다. 훗날 탈퇴/재참여가 생겨 같은 사람에게
-- 새 등록번호를 다시 발급해야 한다면, 이 인덱스를 조건부로 바꾸는 별도
-- migration이 필요하다(예: 유효한 등록 건에만 적용되는 부분 유니크 인덱스).
create unique index if not exists uq_caregiver_registrations_case_caregiver
  on caregiver_registrations (case_id, caregiver_id);

-- caregiver_id 단독 조회용. Postgres는 FK에 인덱스를 자동으로 만들지 않아,
-- caregivers 행을 지울 때(lib/test-reset.ts의 테스트 데이터 정리) 참조
-- 검사가 전체 스캔이 된다. "이 간병인의 등록 건" 조회에도 쓰인다.
-- case_id 단독 인덱스는 따로 만들지 않는다 — 위 (case_id, caregiver_id)
-- 유니크 인덱스의 선두 컬럼이라 그대로 쓰인다.
create index if not exists idx_caregiver_registrations_caregiver_id
  on caregiver_registrations (caregiver_id);

-- legacy_sync_status 인덱스는 지금 만들지 않는다 — 관리자 화면은 사례
-- 목록을 이미 가져온 뒤 앱에서 거르고 있고, 이 테이블은 당분간 행 수가
-- 적어 인덱스 이득보다 유지 비용이 크다. 실제 느려지는 조회가 확인되면
-- EXPLAIN ANALYZE 근거와 함께 그때 추가할 것.


-- ----------------------------------------------------------------------------
-- 4. RLS
-- ----------------------------------------------------------------------------
alter table caregiver_registrations enable row level security;

-- 관리자만 직접 조회할 수 있다. is_admin()은 admin_users + auth.uid() 기반
-- 이고, 관리자는 지금도 Supabase Auth(이메일+비밀번호)로 로그인하므로 이
-- 정책은 실제로 동작한다.
drop policy if exists caregiver_registrations_select on caregiver_registrations;
create policy caregiver_registrations_select on caregiver_registrations
  for select
  using (is_admin());

-- 간병인용 SELECT 정책은 일부러 두지 않는다.
--
-- 다른 테이블들이 쓰는 my_case_ids()/current_caregiver_id()는
-- `caregivers.auth_user_id = auth.uid()`를 전제로 하는데, 이 앱의 간병인은
-- 더 이상 Supabase Auth JWT를 갖지 않는다(자체 발급 세션 쿠키 +
-- lib/supabase-admin.ts의 service_role 경로로 전환됨 — lib/caregiver-auth.ts
-- 주석 참고). 그래서 그 헬퍼를 쓴 정책은 간병인 트래픽에서 절대 참이 되지
-- 않는다. 동작하지 않을 정책을 넣어 보호되는 것처럼 보이게 하는 대신,
-- 간병인 대상 조회는 서버 라우트가 세션을 검증한 뒤 service_role로
-- 수행하도록 명시한다(care_logs 등 기존 경로와 같은 방식).
--
-- 쓰기 정책도 두지 않는다(기본 전면 거부) — 등록 건 생성은 SECURITY
-- DEFINER RPC(다음 단계에서 추가할 join_case_v3 등)와 service_role 서버
-- 라우트만 수행한다. 아래 REVOKE로 한 번 더 못박는다.
revoke insert, update, delete on caregiver_registrations from anon, authenticated;


-- ----------------------------------------------------------------------------
-- 5. COMMENT
-- ----------------------------------------------------------------------------
comment on table caregiver_registrations is
  '간병인 등록 건. 사례 1건에 간병인마다 별도 E등록번호와 Sheet 행이 생긴다. cases.registration_no(최초 등록 건 번호, Google Form sync의 upsert 키)는 이 테이블과 별개로 그대로 유지된다.';

comment on column caregiver_registrations.registration_no is
  'generate_e_registration_no()가 발급한 E{YYMMDD}-{NNN}. 전역 유일하며 Google Sheet의 행 식별자와 같은 값이다.';

comment on column caregiver_registrations.registration_type is
  'initial=최초 사례 등록과 함께 생성, family_join=가족코드로 뒤늦게 참여.';

comment on column caregiver_registrations.relationship is
  '등록 당시 환자와의 관계 스냅샷. case_caregivers.relationship이 이후 바뀌어도 Sheet로 나간 값과 어긋나지 않게 한다.';

comment on column caregiver_registrations.consent_id is
  '이 등록 건의 근거가 된 case_consents 행. case_consents에 UNIQUE(case_id, caregiver_id)가 없어 조합 조회가 모호할 수 있어 명시적으로 가리킨다. 과거 데이터 backfill을 위해 nullable.';

comment on column caregiver_registrations.legacy_sync_status is
  '이 등록 건의 Sheet 전송 상태(pending/synced/failed). 값 체계는 cases.legacy_sync_status와 동일하게 맞춘다.';


-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- 이 테이블은 신규이고 기존 테이블을 전혀 ALTER하지 않으므로, 아래 한 줄로
-- 이 migration 이전 상태로 완전히 돌아간다(기존 데이터 영향 없음).
--
-- drop table if exists caregiver_registrations;
