-- ============================================================================
-- 간병인 자체 세션/OTP 테이블 — 운영 DB에 자동 실행하지 않는다.
-- ============================================================================
-- 배경: 간병인 인증을 Supabase Phone Auth에서 Solapi 기반 자체 SMS OTP +
-- 장기 세션 쿠키 방식으로 전환한다(docs/solapi-caregiver-auth.md 참고).
-- 관리자 인증(Supabase Auth 이메일+비밀번호)은 이 변경과 무관하다.
--
-- *** 접근 모델 ***
-- 아래 두 테이블은 우리 Next.js 서버 코드(lib/supabase-admin.ts의
-- service_role 클라이언트)에서만 접근한다. anon/authenticated 역할에는
-- 어떤 정책도 만들지 않아 기본적으로 완전히 차단되며(RLS enabled + 정책
-- 없음 = 전면 거부), service_role은 RLS를 우회하므로 이 정책과 무관하게
-- 항상 접근 가능하다. 이 테이블들을 브라우저에서 anon 키로 직접 조회/
-- 수정하려는 시도는 어떤 경우에도 성공하지 않아야 한다.
--
-- *** 원문 저장 금지 원칙 ***
-- - caregiver_sessions.token_hash: 원문 세션 토�큰은 절대 저장하지 않는다.
--   HMAC-SHA256(CAREGIVER_SESSION_SECRET, 원문 토큰)의 16진수 값만 저장한다.
-- - caregiver_otp_codes.code_hash: OTP 원문은 절대 저장하지 않는다.
--   HMAC-SHA256(CAREGIVER_SESSION_SECRET, 전화번호:코드)의 16진수 값만
--   저장한다.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- caregiver_sessions: 장기 로그인 세션
-- ----------------------------------------------------------------------------
create table if not exists caregiver_sessions (
  session_id uuid primary key default gen_random_uuid(),
  caregiver_id uuid not null references caregivers(caregiver_id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz not null default now(),
  user_agent_hash text,
  created_at timestamptz not null default now()
);

create index if not exists idx_caregiver_sessions_caregiver_id
  on caregiver_sessions (caregiver_id);

create index if not exists idx_caregiver_sessions_token_hash
  on caregiver_sessions (token_hash);

-- 활성 세션만 빠르게 조회하기 위한 부분 인덱스(만료/해제되지 않은 세션)
create index if not exists idx_caregiver_sessions_active
  on caregiver_sessions (caregiver_id)
  where revoked_at is null;

alter table caregiver_sessions enable row level security;
revoke all on caregiver_sessions from anon, authenticated;


-- ----------------------------------------------------------------------------
-- caregiver_otp_codes: 1회용 SMS 인증코드
-- ----------------------------------------------------------------------------
create table if not exists caregiver_otp_codes (
  otp_id uuid primary key default gen_random_uuid(),
  phone_normalized text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  verified_at timestamptz,
  consumed_at timestamptz,
  failed_attempts int not null default 0,
  send_count int not null default 1,
  last_sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 전화번호별 최신순 조회(재발송 쿨다운, 일일 발송량, 검증 대상 조회에 사용)
create index if not exists idx_caregiver_otp_codes_phone_created
  on caregiver_otp_codes (phone_normalized, created_at desc);

alter table caregiver_otp_codes enable row level security;
revoke all on caregiver_otp_codes from anon, authenticated;

-- ============================================================================
-- ROLLBACK (필요 시 수동 실행 — 세션/OTP 이력이 모두 사라짐에 유의)
-- ============================================================================
-- drop table if exists caregiver_otp_codes;
-- drop table if exists caregiver_sessions;
