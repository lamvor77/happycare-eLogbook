# 간병인 인증(Supabase Phone OTP) 가이드

3단계에서 간병인 로그인이 "휴대폰번호 조회 + localStorage 저장" 방식에서
Supabase Auth 휴대폰 OTP 기반 세션 로그인으로 전환되었다. 이 문서는 운영
전환에 필요한 Supabase 설정과 검증 절차를 정리한다.

새로운 환경변수는 없다. SMS 발송 설정은 앱의 `.env`가 아니라 Supabase
Dashboard(프로젝트 설정)에 저장되기 때문이다.

## 1. Supabase Phone Auth 활성화

1. Supabase Dashboard → **Authentication → Providers → Phone** 이동.
2. Phone 로그인을 **Enable**.
3. **Enable Phone Confirmations**(OTP 인증)을 켠다.

## 2. SMS 공급자 설정

Supabase는 자체적으로 SMS를 발송하지 않고 외부 공급자(Twilio, MessageBird,
Vonage 등)를 통해 발송한다.

1. Dashboard → **Authentication → Providers → Phone → SMS Provider**.
2. Twilio를 쓴다면 Twilio 콘솔에서 Account SID, Auth Token, Messaging
   Service SID(또는 발신번호)를 발급받는다.
3. 위 값을 Supabase Dashboard의 해당 입력란에 붙여넣는다(우리 앱의
   `.env.local`/`.env.example`에는 넣지 않는다 — Supabase가 자체적으로
   보관/사용한다).
4. 실제 SMS 공급자를 아직 설정하지 않아도 코드 구조(로그인 화면, 서버 검증,
   RLS 초안)는 이미 완성되어 있다. 공급자 설정 전까지는 `signInWithOtp`
   호출이 실패하며, 화면에는 "인증코드 전송에 실패했습니다" 메시지가
   표시된다.

## 3. 기존 caregiver와 Supabase Auth user 연결 방법

`caregivers.auth_user_id`가 채워져 있어야 로그인이 caregiver 권한으로
연결된다. 이번 단계에서는 case-register/case-join 등록 흐름 자체를
변경하지 않았으므로, 신규 가입자에 대해서도 이 연결은 **수동**으로
이루어져야 한다(운영 자동화는 후속 단계 과제로 남겨둔다).

절차:

1. Supabase Dashboard → **Authentication → Users → Add user → Phone**에서
   해당 간병인의 휴대폰번호(E.164, 예: `+821012345678`)로 사용자를 생성한다.
   (또는 이미 signInWithOtp를 한 번 시도해 자동 생성된 미확인 사용자가
   있는지 먼저 확인한다.)
2. 생성된 사용자의 `id`(UUID)를 확인한다.
3. SQL Editor에서 아래처럼 연결한다(실제 값으로 치환):

   ```sql
   update caregivers
   set auth_user_id = '<auth.users.id>',
       phone_normalized = '+821012345678'
   where caregiver_id = '<caregivers.caregiver_id>';
   ```

4. 여러 명을 한 번에 연결해야 한다면 `phone_normalized`와 `auth.users.phone`을
   매칭하는 배치 스크립트를 별도로 작성할 것을 권장한다(SQL 마이그레이션
   파일에는 실제 개인정보를 넣지 않는다).

## 4. 테스트용 사용자 준비

1. 본인 명의 테스트 휴대폰번호로 Supabase Auth 사용자를 하나 생성한다.
2. 위 3번 절차로 테스트용 `caregivers` 행(또는 새로 만든 테스트 행)과
   연결한다.
3. 해당 테스트 사용자를 특정 테스트 case의 `case_caregivers`에
   `is_current_caregiver = true`, `status = '활성'`으로 연결해 둔다.
4. 이 상태에서 `/caregiver-login`으로 로그인 → 해당 case의
   `/case-care-log/[id]`에서 저장이 되는지 확인한다.

## 5. RLS SQL 적용 순서

`supabase/migrations/` 아래 파일을 **이 순서대로**, 각 단계마다 결과를
확인하면서 수동 적용한다(자동 실행 금지):

1. `20260803120000_caregiver_auth_link.sql` — `auth_user_id`,
   `phone_normalized`, `resident_number_masked` 컬럼 추가.
2. `20260803120200_case_caregiver_functions.sql` — 현재 간병인 변경
   RPC(`set_current_caregiver`)와 부분 유니크 인덱스.
3. `20260803120300_rls_policies.sql` — 실제 RLS 정책.
   **주의**: 이 파일을 적용하기 전에 반드시 아래를 먼저 처리할 것.
   - `app/admin/**` 페이지들의 데이터 조회를 `lib/supabase.ts`(anon)에서
     `lib/supabase-server.ts`(로그인 세션 바인딩)로 전환한다. 그렇지 않으면
     관리자 자신도 자기 정책에 막혀 데이터를 볼 수 없다.
   - `app/log`, `app/case-register`, `app/case-join`,
     `app/api/google-form-sync`의 anon insert/조회 경로를 서버 라우트 +
     `service_role`(또는 별도 anon insert 정책)로 전환한다. 전환 전에 이
     RLS를 적용하면 신규 등록/구글폼 연동이 즉시 실패한다.
   - 자세한 영향 목록은 `20260803120300_rls_policies.sql` 파일 상단 주석
     참고.

각 파일은 staging 프로젝트에서 먼저 적용해 보고, 기존 화면들이 예상대로
동작(또는 예상대로 차단)하는지 확인한 뒤 운영에 반영한다.

## 6. 운영 전 테스트 체크리스트

- [ ] `/caregiver-login`에서 등록되지 않은 번호로 시도 시 실패 메시지가 뜨는가
- [ ] 등록된 번호로 OTP 수신 및 로그인이 되는가(SMS 공급자 설정 후)
- [ ] 로그인 성공 후 `/api/caregiver/me`가 caregiver 정보를 반환하는가
- [ ] 현재 간병인 계정으로 `/case-care-log/[id]`에서 저장이 되는가
- [ ] 현재 간병인이 **아닌** 로그인 계정으로는 저장 버튼이 비활성/차단되는가
- [ ] 비로그인 상태로 저장 API를 직접 호출하면 401이 오는가
- [ ] 현재 간병인 변경, 간병종료가 각각 권한 있는 계정에서만 성공하는가
- [ ] 브라우저 개발자도구에서 `localStorage.setItem("caregiver_id", ...)`로
      값을 조작해도 저장/변경/종료가 되지 않는가(아래 7번 참고)
- [ ] RLS 적용 전, 영향 목록에 있는 모든 화면이 여전히 동작하는지
      staging에서 확인했는가

## 7. localStorage 로그인 방식 제거 확인 방법

1. 브라우저 개발자도구 콘솔에서 아래를 실행해 값을 임의로 주입한다.

   ```js
   localStorage.setItem("caregiver_id", "아무-uuid-값");
   localStorage.setItem("caregiver_name", "아무개");
   ```

2. 로그인하지 않은 상태로 `/case-care-log/[id]`에 접속했을 때, "현재
   간병인으로 로그인한 경우에만 작성할 수 있습니다" 화면이 그대로
   나오는지 확인한다(주입한 localStorage 값이 아무 영향을 주지 않아야 함).
3. 저장 버튼이 비활성화되어 있거나, 강제로 클릭/요청을 보내더라도
   서버가 401/403을 반환하는지 네트워크 탭에서 확인한다.
4. `app/caregiver-login/page.tsx`, `app/case-care-log/[id]/CareLogClient.tsx`,
   `app/cases/[id]/ChangeCurrentCaregiver.tsx`,
   `app/cases/[id]/EndCareButton.tsx` 소스에 `localStorage.getItem("caregiver_id")`
   또는 `localStorage.getItem("caregiver_name")`을 권한 판단에 사용하는
   코드가 없는지 grep으로 재확인한다.

   ```bash
   grep -rn "caregiver_id\|caregiver_name" app --include="*.tsx" | grep -i localstorage
   ```

   `caregiver-login/page.tsx`의 "제거(removeItem)" 호출만 남아 있어야 하며,
   `getItem`으로 값을 읽어 권한을 판단하는 코드는 없어야 한다.
