-- ============================================================================
-- RLS 긴급 롤백 스크립트 — 운영 DB에 자동 실행하지 않는다.
-- ============================================================================
-- 이 파일은 20260803120050_admin_users.sql, 20260803120200_case_caregiver_
-- functions.sql, 20260803120400_registration_functions.sql,
-- 20260803120500_rls_policies.sql 네 개를 적용한 뒤 문제가 생겼을 때
-- 되돌리기 위한 것이다.
--
-- *** 데이터 손실 없음(기본 원칙) ***
--   - 이 스크립트는 정책(policy)과 함수(function)만 제거하고, RLS를
--     "활성 상태로 두되 정책만 없앤 상태"로 만든다. 정책이 하나도 없는
--     테이블에 RLS가 켜져 있으면 그 역할(anon/authenticated)은 모든
--     행에 접근할 수 없게 된다(전면 차단) — 즉 "제한 없음"이 아니라
--     "완전 차단"이 기본 안전 방향이다.
--   - alter table ... disable row level security는 기본적으로 실행하지
--     않는다(아래 "완전 원복" 섹션에 별도로 분리해두었고, 실행하면 RLS 적용
--     이전처럼 anon 키로 모든 데이터에 접근 가능해지므로 반드시 원인 파악
--     후 의도적으로만 실행할 것 — 큰 경고 참고).
--   - admin_users 테이블, caregivers.auth_user_id/phone_normalized/
--     resident_number_masked 컬럼, 기존 데이터는 이 스크립트가 삭제하지
--     않는다.
--
-- *** 운영 장애 시 긴급 복구 순서 ***
--   1. 장애 증상 확인: 관리자 화면이 안 보이는가(admin_users 미등록
--      가능성) / 간병인이 자기 사례를 못 보는가(auth_user_id 미연결
--      가능성) / 특정 API가 500/403을 뱉는가.
--   2. 먼저 "부분 원복"(아래 섹션 1~3)만 시도한다 — 정책/함수만 제거하고
--      RLS는 켜진 채로 둔다. 이 상태에서도 anon 조회는 여전히 차단되므로
--      공개 페이지(/log 등)는 get_public_hospital 등 공개 함수가 없으면
--      즉시 깨진다는 점에 주의 — 그래서 보통은 "부분 원복"보다
--      "원인이 된 파일만 재적용/수정"이 더 나은 선택이다.
--   3. 그래도 서비스가 정상화되지 않으면, 마지막 수단으로 아래 "완전
--      원복"(섹션 4)을 실행해 RLS 자체를 끈다. 이 경우 RLS 적용 이전과
--      동일한 보안 수준(anon key로 직접 접근 가능)으로 돌아간다는 것을
--      반드시 인지하고, 서비스 정상화 직후 원인을 재분석해 다시 적용
--      절차를 밟는다.
--   4. 애플리케이션 코드는 이 SQL 롤백과 별개로 이전 배포로 되돌릴 수
--      있다(Vercel 등). 코드 롤백과 SQL 롤백은 독립적으로 판단할 것 —
--      4/5단계에서 배포한 서버 API/RPC 호출 코드는 RLS가 꺼져 있어도
--      정상 동작하도록 작성되어 있다(RPC가 있으면 RPC를 쓰고, 없으면
--      실패하는 방식이 아니라 애초에 필수 경로이므로 반드시 RPC까지
--      함께 배포되어 있어야 한다는 점은 동일).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. 20260803120500_rls_policies.sql 되돌리기 (정책/함수만 제거)
-- ----------------------------------------------------------------------------
drop policy if exists care_log_photos_storage_insert on storage.objects;
drop policy if exists care_log_photos_storage_select on storage.objects;

drop policy if exists hospitals_admin_delete on hospitals;
drop policy if exists hospitals_admin_update on hospitals;
drop policy if exists hospitals_admin_write on hospitals;
drop policy if exists hospitals_select_admin on hospitals;
drop policy if exists hospitals_select_active_public on hospitals;

drop policy if exists case_history_insert on case_history;
drop policy if exists case_history_select on case_history;

drop policy if exists care_log_photos_insert on care_log_photos;
drop policy if exists care_log_photos_select on care_log_photos;

drop policy if exists care_logs_insert_current_caregiver on care_logs;
drop policy if exists care_logs_select on care_logs;

drop policy if exists case_caregivers_select on case_caregivers;

drop policy if exists cases_update_current_caregiver on cases;
drop policy if exists cases_select on cases;

drop policy if exists caregivers_select on caregivers;

drop function if exists get_public_hospital(text, text);
drop function if exists my_case_ids();
drop function if exists current_caregiver_id();

-- 컬럼 단위 GRANT/REVOKE 원복(정책 삭제만으로는 컬럼 권한이 되돌아가지
-- 않는다 — RLS가 켜진 채로 있다면 정책이 없어졌으므로 어차피 전면 차단
-- 상태지만, 만약 이후 "완전 원복"까지 진행한다면 아래를 실행해 컬럼 권한도
-- 원래 있던 넓은 상태로 되돌려야 anon/authenticated가 다시 select할 수
-- 있다):
--   grant select on caregivers to authenticated;  -- 원문 컬럼 포함, 주의
--   grant select on hospitals to anon, authenticated;
-- 위 두 줄은 기본적으로 실행하지 않는다(원문 주민등록번호까지 다시 열리는
-- 문제가 있으므로, 완전 원복이 꼭 필요한 경우에만 검토 후 실행할 것).


-- ----------------------------------------------------------------------------
-- 2. 20260803120400_registration_functions.sql 되돌리기
-- ----------------------------------------------------------------------------
-- 주의: 이 함수들을 제거하면 app/api/cases/register, app/api/cases/join이
-- 즉시 실패한다(둘 다 이 RPC 호출에 의존). 애플리케이션도 함께 이전
-- 버전으로 되돌리는 경우에만 이 섹션을 실행할 것.
drop function if exists join_case(text, text, text, text, text);
drop function if exists register_case(
  uuid, text, date, text, text, text, text, text, text, text, text,
  text, text, date, date, text, boolean, text, text, text
);


-- ----------------------------------------------------------------------------
-- 3. 20260803120200_case_caregiver_functions.sql 되돌리기
-- ----------------------------------------------------------------------------
-- 주의: 이 함수를 제거하면 app/api/cases/[id]/current-caregiver가 즉시
-- 실패한다("현재 간병인 변경" 기능 불가). 부분 유니크 인덱스는 데이터
-- 정합성 보호 목적이라 기본적으로는 유지를 권장하지만, 색인 자체가
-- 문제(예: 스캔 비용, 예기치 못한 제약 위반)라면 함께 제거할 수 있다.
drop function if exists set_current_caregiver(uuid, uuid);
-- drop index if exists uq_case_caregivers_one_current; -- 기본적으로는 유지 권장


-- ----------------------------------------------------------------------------
-- 4. 완전 원복(최후 수단) — RLS 자체를 끈다
-- ----------------------------------------------------------------------------
-- *** 경고 ***: 아래를 실행하면 anon/authenticated 키로 caregivers/cases/
-- case_caregivers/care_logs/care_log_photos/case_history/hospitals/
-- admin_users 전체가 다시 무방비로 열린다(RLS 적용 이전 상태와 동일한
-- 보안 수준). 정말로 서비스 정상화가 시급하고 다른 원복으로 해결되지
-- 않을 때만, 그리고 이후 반드시 원인을 재분석해 재적용할 계획이 있을
-- 때만 실행한다. 기본적으로는 주석 처리된 상태로 둔다.
--
-- alter table caregivers disable row level security;
-- alter table cases disable row level security;
-- alter table case_caregivers disable row level security;
-- alter table care_logs disable row level security;
-- alter table care_log_photos disable row level security;
-- alter table case_history disable row level security;
-- alter table hospitals disable row level security;
-- alter table admin_users disable row level security;
--
-- 위 alter table들과 함께, 위 1번 섹션 하단에 있는 컬럼 권한 원복 GRANT도
-- 함께 실행해야 실제로 예전처럼 select("*")가 동작한다.


-- ----------------------------------------------------------------------------
-- 이 스크립트가 삭제하지 않는 것들(명시적 확인)
-- ----------------------------------------------------------------------------
-- - admin_users 테이블 자체와 그 안의 등록된 관리자 데이터
-- - caregivers.auth_user_id / phone_normalized / resident_number_masked 컬럼과 값
-- - cases/caregivers/case_caregivers/care_logs 등 실제 업무 데이터
-- - uq_case_caregivers_one_current 부분 유니크 인덱스(기본적으로 유지)
--
-- 이 항목들까지 되돌리려면(비권장, 데이터 손실 가능) 각 원본 마이그레이션
-- 파일 하단의 ROLLBACK 주석을 참고해 개별적으로, 신중하게 실행할 것.
