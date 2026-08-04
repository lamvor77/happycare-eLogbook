# 간병인 인증(Solapi SMS OTP + 장기 세션) 가이드

8단계에서 간병인 인증이 Supabase Phone Auth(`docs/caregiver-auth.md`,
이제 구버전)에서 **Solapi 기반 자체 SMS OTP + 자체 발급 HttpOnly 세션
쿠키** 방식으로 전면 교체되었다. 관리자 인증(Supabase Auth 이메일+비밀번호)은
이 변경과 무관하며 그대로 유지된다.

## 0. 한눈에 보는 구조

- 최초 등록/가족간병인 추가 시 **딱 1회** 휴대폰 OTP 인증.
- 인증 성공 시 서버가 `caregiver_sessions` 테이블에 세션을 만들고,
  HttpOnly/Secure/SameSite=Lax 쿠키(`hc_caregiver_session`)를 내려준다.
- 같은 브라우저에서는 간병이 끝날 때까지(또는 최대 180일) 추가 OTP 없이
  이용할 수 있다.
- QR 접속만으로는 절대 자동으로 작성 화면으로 이동하지 않는다 —
  `app/log`에서 사용자가 `[간병일지 작성]`을 직접 눌러야 한다.
- 모든 caregiver 관련 서버 조회/변경은 `service_role` 클라이언트로만
  수행한다. caregiver는 더 이상 Supabase Auth JWT를 갖지 않으므로,
  기존 `auth.uid()` 기반 RLS 정책은 이 경로에서는 **사실상 적용되지 않는다**
  (자세한 내용은 8절 참고). 대신 `caregiver_sessions`/`caregiver_otp_codes`
  테이블은 RLS를 켠 채 anon/authenticated에 대한 정책을 하나도 만들지
  않아(default-deny), service_role만 접근 가능하다.

## 1. Solapi 가입 및 발신번호 등록

1. https://solapi.com 에서 계정을 만든다(사업자 인증이 필요할 수 있음).
2. Solapi 콘솔 → **발신번호 관리**에서 실제 발송에 사용할 발신번호를
   등록하고, 통신사 사전승낙(또는 본인인증) 절차를 완료해 **승인** 상태로
   만든다. 승인되지 않은 발신번호로는 발송이 실패한다.
3. 발신번호는 하이픈 없는 숫자 형식(예: `0212345678` 또는
   `01012345678`)으로 등록한다.

## 2. API 키 발급

1. Solapi 콘솔 → **API Key 관리**에서 새 키를 발급한다.
2. `API Key`와 `API Secret Key`를 안전하게 보관한다(콘솔에을 벗어나면
   Secret은 다시 조회할 수 없는 경우가 많으므로 즉시 안전한 곳에 기록).
3. 이 값들은 앱 코드/레포/문서 어디에도 하드코딩하지 않는다. 오직 배포
   환경변수로만 설정한다.

## 3. Vercel 환경변수 설정

Vercel 프로젝트 → **Settings → Environment Variables**에서 아래 4개를
서버 전용(Production/Preview/Development 필요한 범위에) 설정한다. 이름만
아래와 같이 맞추면 되고, `.env.example`에는 이름만 존재하고 값은 비어
있다.

| 변수 | 설명 |
| --- | --- |
| `SOLAPI_API_KEY` | Solapi API Key |
| `SOLAPI_API_SECRET` | Solapi API Secret Key |
| `SOLAPI_SENDER_NUMBER` | 승인된 발신번호(숫자만) |
| `CAREGIVER_SESSION_SECRET` | 세션 토큰/OTP 코드 해시(HMAC-SHA256)에 쓰는 서버 전용 시크릿. 최소 32바이트 이상의 무작위 값 권장(`openssl rand -base64 32` 등으로 생성) |

`NEXT_PUBLIC_` 접두사를 붙이지 않는다 — 붙이면 클라이언트 번들에 노출되어
치명적이다. 로컬 개발 시 `.env.local`에도 실제 값을 넣되, 이 파일은 커밋
금지(`.gitignore`에 이미 포함되어 있는지 확인).

## 4. OTP 정책

- 코드 형식: 6자리 숫자, `crypto.randomInt`로 생성.
- 만료: 발송 후 **5분**.
- 재발송 제한: 동일 번호로 **60초** 이내 재발송 불가.
- 일일 발송 한도: 동일 번호 **하루 10회**.
- 실패 제한: 코드 불일치가 **5회** 누적되면 해당 OTP 건은 더 이상
  검증할 수 없다(새로 발송받아야 함).
- 저장: DB에는 코드 원문을 절대 저장하지 않는다. `CAREGIVER_SESSION_SECRET`로
  HMAC-SHA256 해시한 값(`code_hash`)만 저장한다.
- 인증 성공 후 재사용: 인증에 성공한 OTP는 **15분** 이내, 아직
  `consumed_at`이 찍히지 않았다면 등록/참여(register/join) API 제출 시
  자동으로 소비되어, 사용자가 같은 흐름 안에서 OTP를 두 번 입력하지
  않도록 한다. 이 창을 넘기면 다시 인증해야 한다.
- SMS 문구에는 개인정보(환자명, 진단명 등)를 절대 포함하지 않는다. 예:
  `[해피간병] 인증번호는 123456입니다. 5분 이내 입력해주세요.`

## 5. 세션 정책

- 세션 토큰: 33바이트 난수(`crypto.randomBytes(33).toString("base64url")`).
  원문 토큰은 쿠키로만 전달되고, DB에는 HMAC-SHA256 해시(`token_hash`)만
  저장한다.
- 쿠키: `hc_caregiver_session`, `httpOnly: true`,
  `secure: true`(production), `sameSite: "lax"`, `path: "/"`,
  `maxAge`: 180일.
- 매 요청마다 쿠키 → 해시 → `caregiver_sessions` 조회로 재검증한다
  (`revoked_at is null`, `expires_at` 미도래, 연결된 caregiver/사례 상태
  포함). 그래서 만료 기간을 길게(180일) 잡아도 안전하다 — 실제 권한은
  매번 서버에서 다시 확인된다.
- `last_used_at`은 세션이 조회될 때마다 갱신된다.
- 로그아웃(`POST /api/caregiver-auth/logout`) 시 해당 세션의
  `revoked_at`을 채우고 쿠키를 삭제한다.
- 간병종료(`end-care`) 처리 시, 해당 caregiver가 다른 "입원중" 사례에
  더 이상 연결되어 있지 않으면 그 caregiver의 모든 세션을 일괄 폐기한다
  (`revokeAllSessionsForCaregiver`). 다른 활성 사례가 남아 있으면 세션은
  유지된다.
- 세션이 있어도 `case_caregivers.is_current_caregiver = true` +
  `status = '활성'` + `cases.status = '입원중'`을 만족하지 않으면 해당
  사례에 대한 작성/변경 권한은 없다 — 간병종료된 사례는 세션이 살아있어도
  항상 차단된다.

## 6. 장애 대응

- **Solapi 발송 실패(4xx/5xx)**: `lib/solapi.ts`의 `sendSms`가
  `SolapiError`를 던지고, `send-otp` 라우트는 이를 502로 매핑해 사용자에게
  "인증코드 전송에 실패했습니다"를 보여준다. 로그에는 HTTP 상태 코드만
  남기고 응답 본문/전화번호는 남기지 않는다.
- **발신번호 미승인 상태로 배포한 경우**: 모든 발송이 실패하므로, 먼저
  Solapi 콘솔에서 발신번호 승인 상태를 확인한다.
- **환경변수 누락**: `lib/solapi.ts`/`lib/caregiver-session.ts`는 함수
  호출 시점에 필요한 환경변수를 읽고, 없으면 즉시 에러를 던진다(빌드
  타임에는 검사하지 않음 — 다른 서버 전용 모듈과 동일한 패턴). Vercel
  배포 후 실제 발송/로그인 흐름을 한 번 수동으로 확인할 것을 권장한다.
- **대량 인증 실패/이상 트래픽**: 일일 발송 한도(10회/번호)와 재발송
  쿨다운(60초)이 1차 방어선이다. 추가로 필요하다면 Vercel/방화벽 레벨의
  IP 레이트리밋을 검토한다.
- **세션 시크릿 유출 의심 시**: `CAREGIVER_SESSION_SECRET`을 즉시
  교체하고, `caregiver_sessions` 테이블의 기존 세션을 전부 폐기
  (`revoked_at = now()`)한다 — 시크릿이 바뀌면 기존 토큰의 해시가 더 이상
  일치하지 않으므로 자동으로도 무효화되지만, 명시적으로 폐기해 두는 것이
  안전하다.

## 7. 비용/발송 실패 처리

- Solapi는 건당 과금이므로, 재발송 쿨다운(60초)과 일일 한도(10회)가
  비용 상한선 역할도 겸한다. 트래픽이 늘면 콘솔에서 사용량/잔액을
  주기적으로 확인한다.
- 발송 실패가 사용자에게 어떻게 보이는지: `send-otp` 응답이 실패하면
  화면에는 일반적인 오류 메시지만 노출되고, 실패 사유(잔액 부족, 미승인
  발신번호 등) 같은 상세 정보는 서버 로그에만 남긴다(전화번호는 마스킹).
- 결제/잔액 부족으로 전체 발송이 막히는 경우를 대비해, 운영 담당자가
  Solapi 콘솔 잔액 알림을 설정해 두는 것을 권장한다(코드 레벨 대응은
  아님 — 운영 절차).

## 8. 기존 Supabase Phone Auth에서의 전환 절차

1. **코드 전환은 완료됨**: `lib/caregiver-auth.ts`가 더 이상
   `supabase.auth.*`를 호출하지 않는다. `app/caregiver-login`,
   `app/case-register`, `app/case-join`은 모두
   `/api/caregiver-auth/send-otp`, `/api/caregiver-auth/verify-otp`를
   사용한다.
2. **`auth_user_id` 컬럼은 삭제하지 않는다**: 과거 데이터 호환/마이그레이션
   대조용으로 남겨둔다. 새 코드 경로는 이 컬럼을 더 이상 읽거나 쓰지
   않으며, caregiver 식별은 전적으로 `phone_normalized` +
   `caregiver_sessions`로 이루어진다.
3. **RLS 정책의 위상 변화**: `20260803120500_rls_policies.sql`에서
   caregiver용으로 만든 `auth.uid()` 기반 정책(`my_case_ids()`,
   `current_caregiver_id()`, `care_logs_insert_current_caregiver` 등)은
   caregiver가 더 이상 Supabase Auth JWT로 요청하지 않으므로 이 경로에서는
   **사실상 발동되지 않는다**(항상 service_role로 우회). 이 정책들은
   삭제하지 않았고 DB에는 여전히 존재하며, 관리자(`is_admin()`)용 정책과
   레거시/직접 DB 접근 시나리오에 대한 방어선으로는 계속 유효하다. 다만
   caregiver 경로의 실질적인 권한 검증은 이제 전적으로
   `lib/caregiver-auth.ts`(`requireCaregiverSession`,
   `requireCurrentCaregiverSession`)에서 서버 코드로 수행된다는 점을
   운영/보안 검토 시 반드시 인지하고 있어야 한다.
4. **Supabase Phone Provider는 더 이상 caregiver 로그인에 쓰이지 않는다**:
   Dashboard의 Phone Auth 설정(및 연결된 SMS 공급자)을 그대로 켜 두어도
   무방하지만, 사용하지 않는다면 비활성화해 혼선을 줄이는 것을 권장한다.
   관리자 로그인은 이메일+비밀번호 Provider를 그대로 사용하므로 영향
   없다.
5. **기존 `docs/caregiver-auth.md`는 구버전으로 남겨둔다**: 과거 이력
   참고용으로만 보고, 실제 운영 절차는 이 문서를 따른다.
6. **전환 검증 체크리스트**는 `docs/solapi-caregiver-auth.md`(본 문서)
   9절을 따른다.

## 9. 운영 전 검증 체크리스트

- [ ] 최초 등록(`/case-register`) 시 OTP 인증 없이는 등록이 완료되지
      않는가
- [ ] 최초 등록 성공 직후 쿠키(`hc_caregiver_session`)가 생성되는가
- [ ] 같은 브라우저로 QR을 다시 스캔해 `[간병일지 작성]`을 눌렀을 때
      OTP 없이 바로 진행되는가
- [ ] `app/log`에 QR로 접속했을 때 자동으로 작성 화면으로 이동하지
      **않는가**(버튼 클릭이 반드시 필요한가)
- [ ] 쿠키가 없는 브라우저(시크릿 모드 등)에서는 OTP가 다시 요구되는가
- [ ] 다른 기기에서 접속하면 OTP가 요구되는가
- [ ] 현재 간병인이 아닌 일반 가족 계정으로는 간병일지 작성이 차단되는가
- [ ] 현재 간병인 계정으로는 정상적으로 작성되는가
- [ ] 간병종료된 사례는 세션이 남아 있어도 작성이 차단되는가
- [ ] 브라우저 콘솔에서 `localStorage.setItem("caregiver_id", ...)` 등을
      주입해도 권한을 얻지 못하는가(권한 판단이 쿠키/서버 세션에만
      의존하는가)
- [ ] 관리자 로그인(이메일+비밀번호)이 이번 변경과 무관하게 정상
      동작하는가
- [ ] `npm run lint`가 통과하는가
- [ ] `npm run build`가 통과하는가

실 Solapi 계정/발신번호 승인 없이는 6~7번(실제 SMS 수신 확인)까지는
로컬/스테이징에서 완전히 검증할 수 없다 — 콘솔 설정 완료 후 반드시
실제 휴대폰으로 한 번 이상 수동 검증할 것.
