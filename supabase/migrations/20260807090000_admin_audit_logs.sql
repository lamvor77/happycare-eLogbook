-- ============================================================================
-- admin_audit_logs — 관리자 행위 감사 로그 (운영 DB에 자동 실행하지 않는다)
-- ============================================================================
-- 1차 용도: /admin/test-reset(테스트 데이터 초기화)의 Preview/Execute 기록.
-- 이후 다른 관리자 행위(예: PDF 열람 로그 — docs/privacy-data-policy.md 11절
-- 후속 과제)에도 같은 테이블을 재사용할 수 있도록 action을 자유 텍스트로
-- 둔다.
--
-- *** PII 저장 금지 ***
-- 이 테이블에는 환자명/주민등록번호/전화번호/좌표 등 개인정보를 저장하지
-- 않는다. target_id에는 uuid(caregiver_id/case_id/hospital_id)만 넣고,
-- 전화번호 기준 초기화라도 "전화번호"가 아니라 서버가 조회한 caregiver_id를
-- 저장한다. summary에는 건수만 문자열로 남긴다.
--
-- *** Preview 강제 구조 ***
-- execute API는 "직전에 같은 관리자가 같은 대상에 대해 만든 preview 행"이
-- 있어야만 실행된다. preview도 이 테이블에 action='TEST_RESET_PREVIEW'로
-- 남고, 실행 기록은 action='TEST_RESET' + related_preview_id로 그 preview를
-- 참조한다(같은 preview를 두 번 소비하지 못하도록 API가 확인한다).
-- ============================================================================

create table if not exists admin_audit_logs (
  audit_id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id),
  admin_email text not null,
  action text not null,
  target_type text not null,
  target_id uuid,
  -- 전화번호 기준 초기화에서 관리자가 체크한 사례 목록(uuid만, PII 아님).
  target_case_ids jsonb,
  summary text,
  related_preview_id uuid references admin_audit_logs(audit_id),
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_audit_logs_created_at
  on admin_audit_logs (created_at desc);

create index if not exists idx_admin_audit_logs_admin_action
  on admin_audit_logs (admin_user_id, action, created_at desc);

create index if not exists idx_admin_audit_logs_related_preview
  on admin_audit_logs (related_preview_id)
  where related_preview_id is not null;

alter table admin_audit_logs enable row level security;

-- 관리자만 조회 가능. insert/update/delete 정책은 두지 않는다(기본 거부) —
-- 기록은 오직 service_role을 쓰는 서버 라우트(app/api/admin/test-reset/**)
-- 에서만 남기고, 이후 수정/삭제하지 않는다(감사 로그는 불변).
drop policy if exists admin_audit_logs_select on admin_audit_logs;
create policy admin_audit_logs_select on admin_audit_logs
  for select
  using (is_admin());

revoke insert, update, delete on admin_audit_logs from anon, authenticated;

-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- drop policy if exists admin_audit_logs_select on admin_audit_logs;
-- drop table if exists admin_audit_logs;
