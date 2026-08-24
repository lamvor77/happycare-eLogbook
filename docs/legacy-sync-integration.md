# 전자일지 ↔ 기존 가족간병관리 시스템 연동

이 문서는 전자일지와 기존 가족간병관리 시스템(Google Form/Sheet/Apps
Script, 이 저장소 밖) 사이의 두 가지 연동을 모두 다룬다.

1. **등록 전송(아웃바운드)** — 전자일지 QR 최초 등록 성공 시 등록정보를
   기존 시스템으로 자동 전송한다.
2. **보험사 옵션 조회** — 전자일지 등록 화면이 기존 Google Form의
   "보험사" 선택지를 매번 조회해온다(작업 15~19).

두 연동 모두 **이 저장소는 호출하는 쪽만 구현한다.** 실제 수신
엔드포인트(1)와 조회 엔드포인트(2)는 운영팀이 기존 Apps Script 쪽에
별도로 구축/배포해야 한다 — 이 문서는 그 쪽이 지켜야 할 계약을
설명한다.

---

## 1. 등록 전송 (아웃바운드 웹훅)

### 언제 호출되는가

`app/api/cases/register/route.ts`가 `register_case_v3`로 **신규 사례를
생성**했을 때만(`is_existing=false`) `lib/legacy-sync.ts`의
`syncCaseToLegacySystem(caseId)`를 호출한다. 기존 사례에 간병인이
재연결되는 경우(`is_existing=true`)는 이미 최초 등록 시점에 전송이
끝났으므로 다시 보내지 않는다. Google Form으로 들어온 사례
(`source_type='google_form'`)는 애초에 기존 시스템에서 온 데이터이므로
이 연동의 대상이 아니다.

관리자가 실패한 건을 수동 재시도할 때도(`POST /api/admin/cases/[id]/
legacy-sync`) 같은 함수를 다시 호출할 뿐, 별도 경로를 타지 않는다.

### 요청

```
POST {LEGACY_FAMILYCARE_WEBHOOK_URL}
Content-Type: application/json
x-legacy-sync-secret: {LEGACY_FAMILYCARE_WEBHOOK_SECRET}
```

- 인증은 공유 시크릿 헤더 하나뿐이다(기존 `google-form-sync`의
  `x-happycare-sync-secret` 패턴과 동일한 모델). OAuth 등 다른 인증은
  쓰지 않는다.
- 반드시 HTTPS 엔드포인트여야 한다(작업 29 — 평문 개인정보가 포함되므로
  HTTP는 허용하지 않는다).
- 요청 body의 key는 **실제 기존 Sheet 헤더 문자열**(등록번호/현재상태/
  간병인 성명/... )을 그대로 쓴다 — 전체 필드 목록과 각 필드의 출처,
  전송 여부는
  [docs/legacy-family-care-field-map.md](./legacy-family-care-field-map.md)
  참고.
- 타임아웃: 10초(`REQUEST_TIMEOUT_MS`, `lib/legacy-sync.ts`). 이 시간
  안에 응답하지 못하면 실패로 처리하고 이후 관리자가 재시도한다.

### 응답

- `2xx`만 성공으로 처리한다. 응답 body는 파싱하지 않는다(현재는 상태
  코드만 본다) — 필요해지면 이 문서와 `lib/legacy-sync.ts`를 함께
  갱신한다.
- `4xx`/`5xx`/타임아웃/네트워크 오류는 모두 실패로 기록되고
  `cases.legacy_sync_status = 'failed'`가 된다.

### 중복 처리 (수신 측 구현 필수 조건)

같은 `등록번호`(registration_no)로 두 번째 요청이 오면(관리자 재시도,
네트워크 재시도 등) **중복 행을 새로 만들지 않아야 한다.** `등록번호`를
유일 키로 삼아 **upsert(있으면 갱신) 또는 이미 존재하면 거부** 중 하나로
구현할 것 — 이 저장소 쪽은 몇 번을 재시도해도 안전하도록(idempotent)
설계했으므로, 수신 측도 동일한 전제로 구현해야 한다(작업 26).

### 실패/재시도 구조 (이 저장소 쪽)

- `cases.legacy_sync_status`: `pending`(신규 사례 생성 직후, 첫 전송
  시도 전) → `synced`(전송 성공) 또는 `failed`(전송 실패).
- `cases.legacy_synced_at`: 마지막으로 성공한 시각. 실패 시 갱신하지
  않는다(직전 성공 시각이 있다면 남겨둔다).
- `cases.legacy_sync_error`: 실패 원인의 **안전한 코드**만 저장한다(원문
  에러 메시지·스택트레이스·응답 body 없음):
  - `not_configured` — 웹훅 URL/시크릿 환경변수 미설정
  - `case_not_found` / `no_current_caregiver` — 서버 재조회 실패
  - `decrypt_failed` — 간병인 주민등록번호 복호화 실패(키 버전 문제 등)
  - `timeout` — 10초 내 응답 없음
  - `network_error` — 연결 실패
  - `http_4xx` / `http_5xx` — 수신 측이 실패 상태코드 반환
- 실패해도 **전자일지 등록 자체는 성공 처리한다** — 간병인은 등록
  실패로 느끼지 않는다. 실패는 관리자 화면(`/admin/cases`)에 빨간
  배지로만 노출되고, 관리자가 [다시 전송] 버튼으로 재시도한다(작업 28).
- 자동 재시도(백그라운드 job)는 이번 작업 범위에 없다 — 관리자 수동
  재시도만 구현했다.

---

## 2. 보험사 옵션 조회 (작업 15~19)

전자일지는 보험사 마스터를 갖지 않는다. 기존 Google Form의 "보험사"
질문 선택지를 단일 원본으로 쓰고, 등록 화면을 열 때마다 서버가 대신
조회한다.

```
브라우저(CaseRegisterClient)
  → GET /api/registration-options (이 저장소, 인증 없음, 민감정보 없음)
    → lib/legacy-registration-options.ts (서버 전용)
      → GET {LEGACY_FAMILYCARE_CONFIG_URL}
        x-legacy-sync-secret: {LEGACY_FAMILYCARE_WEBHOOK_SECRET}
        → 기존 Apps Script가 Google Form의 "보험사" 질문 choices를 조회
```

### 기대 응답 형식 (기존 Apps Script 쪽)

```json
{
  "insurance_companies": ["...실제 Google Form의 현재 선택값..."],
  "accident_types": ["질병", "상해", "교통사고"]
}
```

- `insurance_companies`가 없거나 형식이 다르면 이 저장소는 빈 배열로
  처리한다(임의의 목록을 지어내지 않음).
- `accident_types`는 참고용이다 — 이미 실제 값이 확인되어 있어(작업
  11), 이 필드가 없거나 조회 자체가 실패해도 이 저장소가 가진 고정값
  (질병/상해/교통사고)으로 항상 대체한다.

### 캐시/장애 정책 (작업 18)

`lib/legacy-registration-options.ts`가 서버 메모리에 5분 TTL로 캐시한다:

1. TTL 안이면 캐시를 그대로 반환(외부 호출 안 함).
2. TTL이 지나 다시 조회했는데 실패하면, **마지막으로 성공했던 목록**을
   `stale: true`로 반환한다(완전히 막히는 것보다 낫다).
3. 서버가 재시작된 뒤 첫 조회부터 실패하면(캐시가 아예 없음),
   `insuranceCompanies: []`와 `ok: false`를 반환한다 — 이 경우에도
   임의의 보험사 목록을 지어내지 않는다. 화면은 "보험사 정보를 불러오지
   못했습니다. 잠시 후 다시 시도해주세요."를 보여준다.
4. 이 캐시/장애 처리 때문에 Google Form/Apps Script 일시 장애가 전자일지
   등록 전체를 막지는 않는다 — 보험사만 선택할 수 없거나 오래된 목록을
   보여줄 뿐, 다른 필드 입력과 등록 자체는 계속 가능하다.

### 브라우저가 알지 못하는 것

`LEGACY_FAMILYCARE_CONFIG_URL`/`LEGACY_FAMILYCARE_WEBHOOK_SECRET`은
서버 전용 환경변수(`NEXT_PUBLIC_` 아님)로, `lib/
legacy-registration-options.ts` 안에서만 쓰인다. 브라우저는 `GET /api/
registration-options`만 호출하며 이 값들을 전혀 알지 못한다.

---

## 개인정보 처리 (작업 29)

- 간병인 주민등록번호는 `lib/legacy-sync.ts` 안에서 전송 직전에만
  복호화하고, 요청 body를 만든 즉시 더 이상 원문 변수를 참조하지
  않는다.
- 요청 body/응답 body를 console에 출력하지 않는다. 실패 로그에도 안전한
  코드만 남는다.
- `case_history`에는 이 연동에 대해 아무것도 기록하지 않는다(등록 자체의
  `REGISTER` 이력만 남고, 여기서 중복/민감정보 기록을 만들지 않는다).
- 전자일지의 일반 관리자 화면(`/admin/cases`, 사례 상세 등) 어디에도
  간병인 주민등록번호를 표시하지 않는다 — 이 문서가 다루는 연동은
  "기존 시스템으로의 전송"만이며, 전자일지 자체의 표시 범위를 넓히지
  않는다.
- 보험사 옵션 조회에는 개인정보가 전혀 포함되지 않는다(질문 선택지
  문자열뿐).
- 기존 Google Sheet/Apps Script가 주민등록번호를 평문으로 저장하는
  구조라면, 그것은 이 저장소가 결정할 수 있는 범위 밖이다 — 별도의
  개인정보 보안 과제로 운영팀에 확인이 필요하다(현재 운영 요구 없이 이
  저장소가 임의로 그 구조를 바꾸거나 없애지 않는다).

## 환경변수

`.env.example` 참고:

```
LEGACY_FAMILYCARE_WEBHOOK_URL=    # 등록 전송 수신 엔드포인트(운영팀이 별도 구축)
LEGACY_FAMILYCARE_WEBHOOK_SECRET= # 공유 시크릿 — GOOGLE_FORM_SYNC_SECRET과 다른 값 사용, 등록 전송/옵션 조회 공용
LEGACY_FAMILYCARE_CONFIG_URL=     # 보험사/사고유형 옵션 조회 엔드포인트(운영팀이 별도 구축)
```

## 이 저장소가 아직 확인하지 못한 것

- 실제 두 엔드포인트(등록 수신/옵션 조회) URL과 그 인증 방식이 이
  계약과 일치하는지.
- 기존 Apps Script/Sheet가 이 요청 형식(JSON body, 공유 시크릿 헤더)을
  그대로 받을 수 있는지, 아니면 다른 형식이 필요한지 — 운영팀 확인
  필요.
- `docs/legacy-family-care-field-map.md`에 남긴 필드명/값 형식 불확실
  항목 전체 — 특히 **"5. 확인 및 동의"는 실제 Google Form 응답 문자열을
  확인하기 전까지 payload에서 key 자체를 생략한다**(2026-08-23, 임의
  값 "동의함" 전송을 중단함). 그 외 타임스탬프/종료일/비고 전송 여부도
  미확인.
