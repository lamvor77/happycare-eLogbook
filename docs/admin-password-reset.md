# 관리자 비밀번호 찾기/재설정 가이드

관리자 인증은 계속 Supabase Auth 이메일+비밀번호를 쓴다(`ADMIN_EMAILS`,
`admin_users`, `requireAdmin()` 구조는 변경 없음). 이 문서는 비밀번호를
잊었을 때 재설정하는 흐름과, 그러기 위해 Supabase Dashboard에서
확인/등록해야 하는 설정을 정리한다.

## 1. 화면 흐름

1. `/admin/login` 하단의 "비밀번호를 잊으셨나요?" 링크 → `/admin/forgot-password`
2. 이메일 입력 → `supabase.auth.resetPasswordForEmail(email, { redirectTo })`
   호출. 이메일이 실제로 등록되어 있는지와 무관하게 항상 같은 안내 문구를
   보여준다(계정 존재 여부 노출 방지).
3. 관리자가 메일함에서 재설정 링크 클릭 → 운영 도메인의
   `/admin/reset-password`로 이동(Supabase가 URL에 임시 복구 세션 정보를
   담아 리다이렉트한다).
4. `/admin/reset-password`에서 새 비밀번호 + 확인 입력 →
   `supabase.auth.updateUser({ password })` 호출.
5. 성공 시 `/admin/login`으로 이동해 새 비밀번호로 로그인한다.

## 2. Supabase Dashboard 설정 (운영 전 필수 확인)

**운영 도메인**: `https://happycare-elogbook.vercel.app`

1. **Authentication → URL Configuration → Site URL**이 운영 도메인
   (`https://happycare-elogbook.vercel.app`)과 일치하는지 확인한다. Site
   URL이 다르면 재설정 메일의 링크가 엉뚱한 도메인으로 갈 수 있다.
2. **Authentication → URL Configuration → Redirect URLs**에 아래를
   등록한다(둘 다 필요하면 함께):
   - `https://happycare-elogbook.vercel.app/admin/reset-password` (운영)
   - `http://localhost:3000/admin/reset-password` (로컬 개발 시에만)
3. 이메일 템플릿(Authentication → Email Templates → Reset Password)은
   기본 템플릿을 그대로 써도 되며, 별도 커스터마이징이 필요하면 운영팀이
   검토한다(이번 작업 범위 밖).

위 Redirect URL이 등록되어 있지 않으면 `resetPasswordForEmail`의
`redirectTo`가 무시되거나 Supabase가 링크 생성을 거부할 수 있다 —
재설정 메일이 전혀 오지 않는 것처럼 보이는 원인이 될 수 있으므로 반드시
먼저 확인한다.

## 3. 보안 원칙

- 재설정 요청 화면(`/admin/forgot-password`)은 이메일이 실제로 존재하는
  관리자 계정인지 여부를 노출하지 않는다 — 성공/실패 메시지를
  이메일 존재 여부와 무관하게 동일하게 보여준다.
- 서버/브라우저 콘솔에 이메일 주소, 토큰, 복구 링크 전체를 출력하지
  않는다. 오류는 항상 미리 정의한 한국어 안내 문구로만 보여준다(raw
  Supabase `error.message`를 그대로 노출하지 않음).
- `/admin/reset-password`는 `proxy.ts`에서 로그인 여부와 무관하게
  접근은 허용하지만(그래야 메일 링크로 들어올 수 있음), 실제 비밀번호
  변경(`updateUser`)은 Supabase가 발급한 임시 복구 세션이 있어야만
  성공한다 — 세션이 없거나 만료됐으면 Supabase가 에러를 반환하고, 화면은
  "재설정 링크가 만료되었을 수 있습니다"로 안내한다.
- 비밀번호 변경 후에도 실제 관리자 화면 접근 권한은 기존과 동일하게
  `ADMIN_EMAILS`(앱 레벨) + `admin_users`(DB RLS, `is_admin()`) 양쪽을
  모두 통과해야 한다 — 이 기능은 "로그인 가능 여부"만 복구할 뿐, 권한
  체계를 바꾸지 않는다.

## 4. 간병인 인증과의 관계

이 기능은 관리자 이메일+비밀번호 계정에만 적용된다. 간병인의 Solapi
SMS OTP + 자체 세션(`docs/solapi-caregiver-auth.md`)과는 완전히
분리되어 있으며, 이번 작업으로 간병인 인증 흐름은 전혀 바뀌지 않는다.
