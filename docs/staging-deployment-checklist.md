# staging 배포 체크리스트

해피간병을 staging(Vercel + Supabase staging 프로젝트)에 처음 배포할 때
순서대로 확인한다. RLS SQL 적용의 세부 절차는 `docs/rls-rollout.md`를
따르고, 이 문서는 그 앞뒤로 필요한 배포/인프라 작업까지 포함한 전체
그림이다.

## 1. GitHub/Vercel 배포 전 체크

- [ ] `npm run lint` 성공(오류 0건)
- [ ] `npm run build` 성공
- [ ] `git status`가 깨끗하고, 의도한 변경만 커밋되어 있는지 확인
- [ ] `.env.local`, `.env.rls-smoke-test` 등 비밀값이 포함된 파일이
      커밋 이력에 없는지 확인(`git log --all --full-history -- .env.local`)

## 2. Vercel 환경변수 설정

Vercel 대시보드 → 해당 프로젝트 → **Settings → Environment Variables**
에서 아래 5개를 설정한다(`.env.example` 참고, 실제 값은 이 문서에 적지
않는다):

- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — **Production/Preview 환경에만**,
      브라우저에 노출되지 않는 서버 전용 변수로 등록(Vercel에서 별도
      "expose to client" 옵션이 없는 일반 변수로 두면 서버 전용으로
      취급됨. `NEXT_PUBLIC_` 접두사를 붙이지 않았는지 다시 확인)
- [ ] `GOOGLE_FORM_SYNC_SECRET`
- [ ] `ADMIN_EMAILS`

staging과 production을 분리 운영한다면 각 환경별로 다른 Supabase
프로젝트/키를 쓰는지 확인한다(staging 테스트 데이터가 production에
섞이지 않도록).

## 3. Supabase 관리자 Auth 사용자 생성

`docs/rls-rollout.md` 4번(관리자 Bootstrap 절차) 1단계 참고 —
Dashboard → Authentication → Users에서 관리자 이메일 계정을 생성한다.

## 4. admin_users 등록

`docs/rls-rollout.md` 4번 2~3단계 참고 — `20260803120050_admin_users.sql`
적용 후 `admin_users`에 insert, `ADMIN_EMAILS`와 일치 확인.

## 5. SMS 공급자 설정

`docs/caregiver-auth.md` 1~2절 참고 — Supabase Phone Auth 활성화 +
Twilio 등 SMS 공급자 자격증명을 **Supabase Dashboard**(우리 앱의 환경변수
아님)에 등록.

## 6. 테스트 caregiver Auth 사용자 준비

`docs/caregiver-auth.md` 4절 참고 — 실제 테스트용 휴대폰번호로 Supabase
Auth 사용자를 하나 준비해둔다(스모크 테스트, 수동 QA 모두에 사용).

## 7. caregivers.auth_user_id 연결

`docs/rls-rollout.md` 3번(캐어기버 백필 절차) 참고 — 기존 caregiver
행과 위 6번 테스트 계정을 `auth_user_id`로 연결한다.

## 8. pre_rls_audit 실행

`supabase/migrations/checks/pre_rls_audit.sql`을 staging에서 실행하고
결과를 확인한다(`docs/rls-rollout.md` 2번).

## 9. 마이그레이션 5개 순서 적용

```
20260803120000_caregiver_auth_link.sql
20260803120050_admin_users.sql
20260803120200_case_caregiver_functions.sql
20260803120400_registration_functions.sql
20260803120500_rls_policies.sql
```

(`docs/rls-rollout.md` 7번 — 파일명 숫자 순서 그대로 적용)

## 10. post_rls_verification 실행

`supabase/migrations/checks/post_rls_verification.sql`의 각 섹션을
실행해 RLS 활성 여부, 정책 목록, anon 권한, 함수 execute 권한을 확인한다.

## 11. npm run rls:smoke

```bash
npm run rls:smoke
```

`docs/rls-rollout.md` 8-2절의 `.env.rls-smoke-test` 설정 후 실행한다.
8개 시나리오 중 실패가 있으면 원인을 파악하기 전까지 다음 단계로
진행하지 않는다.

## 12. 관리자 로그인 테스트

- [ ] `/admin/login`에서 관리자 계정으로 로그인
- [ ] `/admin` 대시보드에 통계/최근 사례가 정상 표시되는지 확인
- [ ] `/admin/cases`, `/admin/hospitals`, `/admin/location-unavailable`
      각각 데이터가 보이는지 확인
- [ ] 로그아웃 후 `/admin/login`으로 이동하는지 확인

## 13. 병원 QR 조회 테스트

- [ ] `/log?q=<활성 병원 qr_token>` 접속 시 병원명/주소만 보이고
      환자 목록이 나열되지 않는지 확인
- [ ] 존재하지 않는 토큰으로 접속 시 "등록되지 않은 병원입니다" 표시 확인
- [ ] 비활성(`status != active`) 병원 토큰으로 접속 시 적절한 안내 확인

## 14. 최초 등록 테스트

- [ ] `/case-register?q=<qr_token>`에서 휴대폰 인증 → 폼 작성 → 등록 성공
- [ ] 등록 후 `/cases/[id]`로 이동하며 정보가 정확히 표시되는지 확인
- [ ] 동일 병원·환자명·생년월일로 다시 등록 시도 시 기존 사례로
      안내되는지 확인(중복 방지)
- [ ] 주민등록번호 앞 7자리 입력 시 `resident_number_masked`에 마스킹된
      형태로 저장되는지(원문이 아닌지) DB에서 직접 확인(개인정보이므로
      화면 캡처/로그에 남기지 않는다)

## 15. 가족 참여 테스트

- [ ] `/case-join?code=<가족코드>`에서 휴대폰 인증 → 참여 성공
- [ ] 같은 계정으로 다시 참여 시도 시 "이미 연결되어 있습니다" 안내 확인
- [ ] 새로 참여한 간병인은 `is_current_caregiver=false`인지 확인

## 16. 현재 간병인 변경 테스트

- [ ] 현재 간병인 계정으로 다른 간병인으로 변경 성공
- [ ] 변경 직후 case_caregivers에 "현재 간병인"이 정확히 1명인지 확인
- [ ] 현재 간병인이 아닌 계정으로 변경 시도 시 거부되는지 확인
- [ ] `case_history`에 변경 이력이 기록되는지 확인

## 17. 간병일지 위치 성공/실패 테스트

- [ ] 위치 권한을 허용한 상태에서 작성 시 `location_status=checked`,
      위도/경도가 저장되는지 확인
- [ ] 위치 권한을 거부한 상태에서 작성 시 `location_status=unavailable`,
      `location_failure_reason`이 저장되는지 확인
- [ ] 같은 날 두 번째 작성 시도 시 중복 저장이 거부되는지 확인

## 18. 간병종료 테스트

- [ ] 현재 간병인 계정으로 간병종료 성공, `status=간병종료`,
      `care_end_date` 기록 확인
- [ ] 이미 종료된 사례에 다시 종료 시도 시 거부되는지 확인
- [ ] 현재 간병인이 아닌 계정으로 종료 시도 시 거부되는지 확인

## 19. PDF 출력 테스트

- [ ] 관리자 계정으로 `/admin/cases/[id]/print` 접속 시 정상 출력
- [ ] 비관리자(또는 비로그인) 상태로 같은 URL 직접 접속 시 차단되는지 확인
- [ ] 인쇄 버튼 클릭 시 브라우저 인쇄 대화상자가 뜨는지 확인

## 20. Google Form sync 테스트

- [ ] 시크릿 헤더 없이 요청 시 401
- [ ] 잘못된 시크릿으로 요청 시 401
- [ ] 올바른 시크릿으로 요청 시 사례 upsert 성공, service_role 사용 확인
      (Supabase 로그 또는 응답으로 확인, 실제 페이로드는 콘솔에 남기지 않음)

## 21. rollback 조건과 담당자

- **rollback 조건**: 12~20번 중 하나라도 반복 재현되는 실패가 있고
  staging에서 즉시 수정이 어려운 경우, 또는 관리자/전체 간병인이
  차단되는 회귀가 발생한 경우.
- **rollback 절차**: `supabase/migrations/rollback/20260803_rls_rollback.sql`
  과 `docs/rls-rollout.md` 9번을 따른다.
- **담당자 지정**: 실제 배포 시 아래 역할을 팀에서 지정해 문서에 채워
  넣을 것(이 저장소에는 특정 개인 정보를 기재하지 않는다):
  - SQL 적용/롤백 실행 담당자
  - Vercel 배포/환경변수 담당자
  - Supabase Auth/SMS 공급자 설정 담당자
  - 최종 go/no-go 승인자
