-- ============================================================================
-- 관리자 전용 간병일지 삭제(Soft Delete) — 운영 DB에 자동 실행하지 않는다.
-- ============================================================================
-- 배경: 간병일지는 감사 로그 성격이라 하드 삭제 대신 deleted_at/deleted_by/
-- delete_reason을 남기는 소프트 삭제로 구현한다. 삭제는 관리자만 가능하다
-- (간병인은 여전히 작성만 가능, 수정/삭제 불가 — 기존 정책 그대로 유지).
--
-- *** 반드시 staging에서 먼저 아래를 확인하고 적용할 것 ***
-- care_logs 테이블에 이미 (case_id, care_date) 조합의 UNIQUE 제약(또는
-- 인덱스)이 있는지 확인해야 한다. 있다면(관리자가 오늘 일지를 삭제해도
-- 간병인이 같은 날짜로 새로 작성할 수 있어야 하고, 관리자가 삭제된 일지를
-- 복원할 수도 있어야 하므로) 그 제약을 아래처럼 "삭제되지 않은 행에만
-- 적용되는" 부분 유니크 인덱스로 교체해야 한다.
-- 이 파일은 Postgres가 관례적으로 붙이는 이름(care_logs_case_id_care_date_key)
-- 을 시도해 제거하지만, 실제 제약 이름이 다르면 아래 DROP은 아무 일도
-- 하지 않으므로(안전) 적용 후 반드시 확인할 것:
--   select conname from pg_constraint where conrelid = 'care_logs'::regclass;
-- 필요하면 위 조회 결과의 실제 이름으로 별도 DROP CONSTRAINT를 추가 실행한다.
-- 이 제약이 부분 유니크 인덱스로 정확히 교체되지 않으면, 관리자 복원 API
-- (app/api/admin/care-logs/[id]/restore/route.ts)가 항상 500/제약 위반으로
-- 실패하거나, 반대로 원래 있던 옛 전체-UNIQUE 제약이 여전히 살아있다면
-- "삭제된 행이 하나라도 있는 날짜"로는 영구히 재작성/복원이 막힌다. 적용
-- 직후 아래 6번(사전 점검)을 다시 실행해 제약이 정확히 하나(부분 유니크
-- 인덱스)만 남았는지 확인할 것.
--
-- 적용 전 사전 점검(읽기 전용, 실행해도 안전) — 이미 같은 사례·같은
-- 날짜에 "활성" 상태(deleted_at is null) 행이 2건 이상 있다면, 아래 부분
-- 유니크 인덱스 생성 자체가 실패한다(Postgres가 기존 데이터 위반을
-- 감지하면 인덱스를 만들지 않음 — 안전한 실패 모드이지만 원인 데이터를
-- 먼저 정리해야 한다):
--   select case_id, care_date, count(*)
--   from care_logs
--   where deleted_at is null
--   group by case_id, care_date
--   having count(*) > 1;
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. 컬럼 추가
-- ----------------------------------------------------------------------------
alter table care_logs
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id),
  add column if not exists delete_reason text;

-- 활성(삭제되지 않은) 일지만 빠르게 조회하기 위한 부분 인덱스.
create index if not exists idx_care_logs_case_id_active
  on care_logs (case_id)
  where deleted_at is null;

-- 관리자 "삭제된 일지 포함" 필터에서 삭제 시각순 정렬/조회에 사용.
create index if not exists idx_care_logs_deleted_at
  on care_logs (deleted_at)
  where deleted_at is not null;


-- ----------------------------------------------------------------------------
-- 2. (case_id, care_date) 유니크 제약을 "삭제되지 않은 행"에만 적용하도록 교체
-- ----------------------------------------------------------------------------
-- 기존에 하루 1건 제한을 위한 유니크 제약이 테이블 생성 시 이름 없이
-- (case_id, care_date) 형태로 만들어졌다면 Postgres가 자동으로
-- "care_logs_case_id_care_date_key"라는 이름을 붙인다. 이 이름으로 시도한다
-- (없으면 조용히 무시됨 — 위 안내대로 실제 이름을 확인해서 필요시 추가 조치).
alter table care_logs drop constraint if exists care_logs_case_id_care_date_key;

-- 이 부분 유니크 인덱스가 "같은 사례·같은 날짜에는 활성 일지가 최대
-- 1건"이라는 규칙의 최종 방어선이다. 앱 코드(작성 API의 사전 중복 체크,
-- 복원 API의 사전 충돌 체크)는 사용자 경험을 위한 선제 검사일 뿐이고,
-- 동시 요청 등으로 그 검사를 통과한 뒤에도 실제 INSERT/UPDATE가 이
-- 인덱스 위반(에러코드 23505)으로 걸러질 수 있다 — 두 API 모두 23505를
-- 명시적으로 처리해 사용자에게 "같은 날짜에 이미 활성 일지가 있다"는
-- 메시지를 보여준다.
create unique index if not exists uq_care_logs_case_date_active
  on care_logs (case_id, care_date)
  where deleted_at is null;


-- ----------------------------------------------------------------------------
-- 3. RLS: 관리자만 deleted_at/deleted_by/delete_reason을 UPDATE할 수 있다
-- ----------------------------------------------------------------------------
-- 기존 20260803120500_rls_policies.sql이 care_logs에 대해
-- `revoke update, delete on care_logs from anon, authenticated;`로 UPDATE
-- 권한 자체를 걷어갔다(간병일지는 작성 후 수정/삭제 불가라는 원칙). 이번
-- 기능은 그 원칙을 유지한 채, "관리자에 한해서만" 소프트 삭제용 3개 컬럼만
-- 다시 열어준다 — memo 등 내용 컬럼은 여전히 아무도 UPDATE할 수 없다.
grant update (deleted_at, deleted_by, delete_reason) on care_logs to authenticated;

drop policy if exists care_logs_admin_soft_delete on care_logs;
create policy care_logs_admin_soft_delete on care_logs
  for update
  using (is_admin())
  with check (is_admin());

-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- drop policy if exists care_logs_admin_soft_delete on care_logs;
-- revoke update (deleted_at, deleted_by, delete_reason) on care_logs from authenticated;
-- drop index if exists uq_care_logs_case_date_active;
-- -- 필요하면 원래 (case_id, care_date) 유니크 제약을 다시 만들 것.
-- drop index if exists idx_care_logs_deleted_at;
-- drop index if exists idx_care_logs_case_id_active;
-- alter table care_logs
--   drop column if exists delete_reason,
--   drop column if exists deleted_by,
--   drop column if exists deleted_at;
