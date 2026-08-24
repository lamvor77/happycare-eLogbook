-- ============================================================================
-- Hotfix: 운영 DB에서 누락된 registration_no_counters/generate_e_registration_no()
-- 만 복구한다 — 운영 DB에 자동 실행하지 않는다.
-- ============================================================================
-- [운영 DB 상태 — 2026-08-24] 이 hotfix는 운영 DB에 적용 완료됐고,
-- registration_no_counters/generate_e_registration_no() 둘 다 실제 QR
-- 등록 1건으로 정상 동작(E-등록번호 생성)까지 검증됐다. 재실행하지
-- 않는다 — 상세 현황은 docs/legacy-sync-integration.md "운영 DB 적용
-- 이력" 절 참고.
-- ============================================================================
-- 배경: 운영 DB 확인 결과 register_case_v3는 이미 최신 33파라미터 버전
-- (p_admission_status/p_insurance_company_other 포함,
-- 20260823090000_legacy_sync_field_map.sql)이 적용되어 있었지만,
-- registration_no_counters 테이블과 generate_e_registration_no() 함수는
-- 존재하지 않아 신규 QR 등록이 "function generate_e_registration_no()
-- does not exist" 오류로 실패했다. 두 객체는 원래
-- 20260822090000_electronic_registration_no.sql이 만들었어야 했는데,
-- 그 파일이 운영 DB에 (적어도 이 두 객체에 대해서는) 적용되지 않은
-- 상태였던 것으로 보인다.
--
-- 이 파일은 그 20260822 파일 전체를 다시 실행하지 않는다 — 그 파일에는
-- register_case_v3의 구형 31파라미터 CREATE OR REPLACE가 포함되어 있어,
-- 지금 다시 실행하면 이미 존재하는 33파라미터 버전과 별개의 오버로드로
-- 추가 생성되어 register_case_v3가 두 개 존재하는 상태를 만들 수 있다.
-- 그래서 이 hotfix는 20260822090000_electronic_registration_no.sql
-- 42~79줄(registration_no_counters 테이블 + generate_e_registration_no()
-- 함수 정의)만 그대로 재사용한다 — 새로 설계하지 않았다. register_case_v3
-- 자체는 이 파일에서 전혀 CREATE/DROP/ALTER하지 않는다(아래 코드에
-- "register_case_v3" 문자열이 등장하는 곳은 이 헤더 주석과, 원본을 그대로
-- 옮긴 코드 내부 주석 한 줄뿐이며 둘 다 실행 대상이 아니다).
--
-- cases 테이블 컬럼(legacy_sync_status/admission_status/
-- insurance_company_other 등)도 이미 운영 DB에 존재하는 것으로 확인되어
-- (register_case_v3 33파라미터 버전이 그 컬럼들을 참조하는 INSERT문을
-- 포함한 채로 이미 생성되어 있으므로) 이 파일에서 다루지 않는다.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. 날짜별 등록번호 일련번호 카운터
-- (20260822090000_electronic_registration_no.sql 42~79줄과 동일, 재설계
-- 없이 그대로 재사용)
-- ----------------------------------------------------------------------------
create table if not exists registration_no_counters (
  reg_date date primary key,
  last_serial integer not null default 0
);

alter table registration_no_counters enable row level security;
-- 정책 없음(기본 전면 거부) — generate_e_registration_no()(SECURITY
-- DEFINER)를 통해서만 접근한다. 관리자 화면도 이 테이블을 직접 조회할
-- 필요가 없다(등록번호 결과는 cases.registration_no로 이미 노출된다).

create or replace function generate_e_registration_no()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- case_no/family_code(위 두 값은 register_case_v3 안에서 to_char(now(), ...)/
  -- clock_timestamp()로 세션 기본 타임존을 그대로 쓴다)와 달리, 등록번호는
  -- 한국 사용자 기준 "오늘 날짜"가 실제 업무일과 어긋나지 않아야 하므로
  -- Asia/Seoul로 명시 변환한다. 이 함수만의 결정이며 case_no 생성 방식은
  -- 건드리지 않는다.
  v_now timestamptz := now() at time zone 'Asia/Seoul';
  v_today date := v_now::date;
  v_yymmdd text := to_char(v_now, 'YYMMDD');
  v_serial integer;
begin
  insert into registration_no_counters (reg_date, last_serial)
  values (v_today, 1)
  on conflict (reg_date)
  do update set last_serial = registration_no_counters.last_serial + 1
  returning last_serial into v_serial;

  return 'E' || v_yymmdd || '-' || lpad(v_serial::text, 3, '0');
end;
$$;

revoke all on function generate_e_registration_no() from public;

-- authenticated/anon에는 실행 권한을 주지 않는다 — register_case_v3
-- (SECURITY DEFINER, service_role 전용 호출 경로)만 내부에서 호출한다.

-- ============================================================================
-- ROLLBACK (필요 시 수동 실행)
-- ============================================================================
-- drop function if exists generate_e_registration_no();
-- drop table if exists registration_no_counters;
