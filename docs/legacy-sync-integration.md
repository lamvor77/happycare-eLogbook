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

수신 측(Apps Script) 참고/배포용 예제 코드는
[docs/google-apps-script/legacy-webhook.gs](./google-apps-script/legacy-webhook.gs)에
있다 — `doPost(e)` 하나로 등록 수신, `doGet(e)` 하나로 옵션 조회를 모두
처리하며, 같은 Web App 배포 URL 하나로 두 역할을 다 감당할 수 있다(3절
참고). **이 저장소에서 실제로 배포하지는 않는다** — 운영팀이 Apps
Script 프로젝트를 만들어 이 코드를 붙여넣고 직접 배포해야 한다.

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

{
  "secret": "{LEGACY_FAMILYCARE_WEBHOOK_SECRET}",
  "등록번호": "E260824-001",
  "현재상태": "...",
  ...
}
```

- **인증은 헤더가 아니라 JSON body의 `secret` 필드로 한다.** Google Apps
  Script Web App의 `doPost(e)`는 커스텀 요청 헤더를 읽을 수 없다(Apps
  Script의 알려진 플랫폼 제약 — `e` 객체에 `parameter`/`postData`/
  `queryString`은 있어도 요청 헤더가 없다). `x-legacy-sync-secret`
  헤더도 함께 보내긴 하지만(다른 종류의 수신 서버로 교체될 경우를 대비한
  하위 호환용, 무해함) Apps Script 쪽에서는 무시된다 — 실제 인증 판단은
  반드시 `body.secret`으로 한다.
- 반드시 HTTPS 엔드포인트여야 한다(작업 29 — 평문 개인정보가 포함되므로
  HTTP는 허용하지 않는다). Apps Script Web App 배포 URL은 기본적으로
  HTTPS다.
- `secret` 필드를 제외한 나머지 key는 **실제 기존 Sheet 헤더 문자열**
  (등록번호/현재상태/간병인 성명/... )을 그대로 쓴다 — 전체 필드 목록과
  각 필드의 출처, 전송 여부는
  [docs/legacy-family-care-field-map.md](./legacy-family-care-field-map.md)
  참고.
- 타임아웃: 10초(`REQUEST_TIMEOUT_MS`, `lib/legacy-sync.ts`). 이 시간
  안에 응답하지 못하면 실패로 처리하고 이후 관리자가 재시도한다.

### 응답

```json
{ "ok": true, "registration_no": "E260824-001", "action": "inserted" }
{ "ok": true, "registration_no": "E260824-001", "action": "duplicate" }
{ "ok": true, "registration_no": "E260824-001", "action": "updated" }
{ "ok": false, "error": "secret_invalid" }
```

- **`response.ok`(HTTP 2xx)만으로는 성공을 판단하지 않는다.** Apps
  Script Web App은 스크립트가 예외로 죽지 않는 한 거의 항상 HTTP 200을
  반환하므로(`secret_invalid` 같은 실패도 200으로 온다), `lib/
  legacy-sync.ts`는 응답 body를 파싱해 **`ok === true`일 때만** 성공
  (`synced`)으로 기록한다. `ok`가 없거나 `false`이거나 body가 JSON이
  아니면 `invalid_response`로 실패 처리한다.
- `action`이 `"inserted"`/`"duplicate"`/`"updated"` 중 무엇이든
  `ok:true`면 전부 성공으로 처리한다 — 재전송으로 인한 `duplicate`도
  정상 동작이다.
- HTTP 상태코드 자체가 `4xx`/`5xx`인 경우(예: Web App 접근 권한 설정
  오류로 Google이 로그인 페이지를 돌려주는 경우, URL 오타로 404 등)도
  여전히 실패로 처리한다.
- 타임아웃/네트워크 오류도 모두 실패로 기록되고
  `cases.legacy_sync_status = 'failed'`가 된다.
- 응답 body는 `ok` 필드만 확인하고 버린다 — 어떤 필드도 로그로 남기지
  않는다.

### 중복 처리 (수신 측 구현 필수 조건)

같은 `등록번호`(registration_no)로 두 번째 요청이 오면(관리자 재시도,
네트워크 재시도 등) **중복 행을 새로 만들지 않아야 한다.** 예제 코드
(`legacy-webhook.gs`)는 기본적으로 "이미 있으면 새 행 추가 안 하고
`duplicate` 응답"으로 구현되어 있고, Script Properties의
`HAPPYCARE_UPSERT_ON_DUPLICATE`를 `"true"`로 설정하면 기존 행을
업데이트하는 upsert 모드로 바뀐다 — 이 저장소 쪽은 몇 번을 재시도해도
안전하도록(idempotent) 설계했으므로, 수신 측도 동일한 전제로 구현해야
한다(작업 26).

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
  - `invalid_response` — HTTP 상태는 2xx였지만 응답 body가 JSON이
    아니거나 `ok: true`가 아님(예: `secret_invalid`, `header_not_found`
    등 Apps Script가 200으로 반환한 실패)
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
      → GET {LEGACY_FAMILYCARE_CONFIG_URL}?secret={LEGACY_FAMILYCARE_WEBHOOK_SECRET}
        → 기존 Apps Script가 Google Form의 "보험사" 질문 choices를 조회
```

시크릿은 여기서도 헤더가 아니라 **쿼리 파라미터** `?secret=...`로
전달한다(`doGet(e)`도 `doPost(e)`와 동일하게 커스텀 헤더를 읽을 수 없기
때문 — 위 "요청" 절 참고). `x-legacy-sync-secret` 헤더도 함께 보내지만
Apps Script는 무시한다.

### 기대 응답 형식 (기존 Apps Script 쪽)

```json
{
  "ok": true,
  "insurance_companies": ["...실제 Google Form의 현재 선택값..."],
  "accident_types": ["질병", "상해", "교통사고"]
}
```

- 여기서도 HTTP 2xx만으로는 부족하다 — `lib/legacy-registration-options.ts`는
  `body.ok === true`까지 확인한다(`secret_invalid` 등도 200으로 오므로).
  `ok`가 아니면 실패로 취급해 캐시 폴백 로직(아래)으로 넘어간다.
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

## 3. `LEGACY_FAMILYCARE_WEBHOOK_URL`과 `LEGACY_FAMILYCARE_CONFIG_URL`을 같은 URL로 써도 되는가

**된다.** Apps Script Web App은 HTTP 메서드로 `doGet`/`doPost`를 자동
라우팅한다 — 같은 배포 URL에 GET으로 요청하면 `doGet(e)`(보험사 옵션
조회)가, POST로 요청하면 `doPost(e)`(등록 수신)가 실행된다. `action=`
같은 별도 분기 파라미터 없이도 두 환경변수를 완전히 동일한 값으로
설정할 수 있다 — `legacy-webhook.gs`가 이 구조로 작성되어 있다. 별도
Web App 두 개로 나누고 싶다면 그것도 가능하지만(각 파일을 doGet만/
doPost만 남기고 나머지를 지우면 됨) 필수는 아니다.

## 4. Apps Script Script Properties

Apps Script 프로젝트의 "프로젝트 설정 → 스크립트 속성"에서 설정한다
(`legacy-webhook.gs` 헤더 주석과 동일):

| 키 | 값 | 필수 |
| --- | --- | --- |
| `HAPPYCARE_SYNC_SECRET` | 공유 시크릿 — `LEGACY_FAMILYCARE_WEBHOOK_SECRET`과 **동일한 값** | 필수 |
| `HAPPYCARE_SPREADSHEET_ID` | 대상 Google Sheet 스프레드시트 ID | 필수(POST 처리에 필요) |
| `HAPPYCARE_SHEET_NAME` | 대상 시트(탭) 이름 | 선택 — 비우면 첫 번째 시트 사용 |
| `HAPPYCARE_FORM_ID` | 보험사/사고유형 선택지를 읽을 Google Form ID | 선택 — 비우면 보험사 목록 빈 배열 반환(등록 화면은 직접입력 fallback으로 전환됨) |
| `HAPPYCARE_UPSERT_ON_DUPLICATE` | `"true"`면 중복 등록번호를 기존 행 업데이트로 처리 | 선택 — 기본은 새 행 추가 안 함(duplicate 응답만) |

스프레드시트 ID와 시크릿을 스크립트 코드에 직접 적지 않는다 — 전부 이
속성에서 읽는다.

---

## 5. 운영 설정 절차

1. **Apps Script 프로젝트 생성/연결**: 기존 가족간병관리 Google Sheet를
   열고 확장 프로그램 → Apps Script로 새 프로젝트를 만들거나(또는 이미
   그 Sheet에 연결된 기존 프로젝트를 사용), `legacy-webhook.gs`의 내용
   전체를 코드 편집기에 붙여넣는다.
2. **Script Properties 설정**: 위 4절의 5개 키를 실제 값으로 설정한다.
3. **Web App으로 배포**: 배포 → 새 배포 → 유형 "웹 앱" 선택.
4. **실행 사용자/접근 권한**: "실행 계정"은 보통 스크립트 소유자 계정으로,
   "액세스 권한"은 이 웹훅을 호출할 대상(Vercel 서버)만 접근하면 되므로
   운영 정책에 따라 "전체(익명 포함)" 또는 "조직 내"로 설정한다 — 시크릿
   검증이 있으므로 URL을 아는 것만으로 데이터를 쓸 수는 없지만, Web App
   자체의 공개 범위는 필요 이상으로 넓히지 않는 것을 권장한다(작업 I).
5. **Web App URL 복사**: 배포 후 발급되는 `https://script.google.com/
   macros/s/.../exec` 형태의 URL을 복사한다.
6. **Vercel 환경변수 설정**(운영자가 Vercel 대시보드에서 직접 수행 —
   이 저장소/전자일지 코드가 대신 설정하지 않음):
   - `LEGACY_FAMILYCARE_WEBHOOK_URL` = 5번에서 복사한 URL
   - `LEGACY_FAMILYCARE_WEBHOOK_SECRET` = `HAPPYCARE_SYNC_SECRET`과 동일한 값
   - `LEGACY_FAMILYCARE_CONFIG_URL` = 3절에 따라 같은 URL을 그대로 사용 가능
7. **Vercel 재배포**: 환경변수는 재배포해야 반영된다.
8. **`/api/registration-options` 확인**: 배포된 전자일지 도메인에서
   `GET /api/registration-options`를 호출해 `ok: true`와 실제 보험사
   목록이 오는지 확인한다.
9. **QR 등록 1건 테스트**: `/case-register` 화면에서 실제(또는 테스트용)
   QR로 최초 등록 1건을 끝까지 진행한다.
10. **Sheet 등록 확인**: 대상 Google Sheet에 해당 등록번호로 새 행이
    1개만 추가됐는지 확인한다.
11. **`legacy_sync_status='synced'` 확인**: 관리자 사례 목록
    (`/admin/cases`)에서 방금 등록한 사례의 "기존 시스템 연동" 배지가
    "완료"로 표시되는지 확인한다(관리자 전용 SQL 콘솔이 있다면
    `select legacy_sync_status from cases where registration_no = '...'`
    로도 확인 가능 — 이 조회 자체는 이 저장소가 대신 실행하지 않는다).

---

## 6. 개인정보 처리 (작업 29)

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

**Apps Script 쪽(`legacy-webhook.gs`, 운영팀이 배포)도 지켜야 할 원칙**:
- Web App 공개 범위를 필요 이상으로 넓히지 않는다(5절 4번 참고).
- 시크릿은 코드에 하드코딩하지 않고 Script Properties에만 둔다.
- `Logger.log`에 요청 body 전체, 주민등록번호, 전화번호를 남기지 않는다
  — `legacy-webhook.gs`에는 실제로 그런 로그 호출이 없다(코드 전체에
  `Logger.log`를 쓰지 않음).
- 오류 응답(`{ok:false, error:"..."}`)에는 안전한 코드 문자열만 담고,
  스택트레이스나 원문 예외 메시지·개인정보를 포함하지 않는다 —
  `legacy-webhook.gs`의 모든 실패 분기가 고정된 짧은 오류 코드만
  반환하도록 작성되어 있다(`invalid_json`/`secret_invalid`/
  `missing_registration_no`/`sheet_not_found`/`header_not_found`/
  `config_read_failed`).

## 7. 환경변수

`.env.example` 참고:

```
LEGACY_FAMILYCARE_WEBHOOK_URL=    # 등록 전송 수신 엔드포인트(운영팀이 별도 구축)
LEGACY_FAMILYCARE_WEBHOOK_SECRET= # 공유 시크릿 — GOOGLE_FORM_SYNC_SECRET과 다른 값 사용, 등록 전송/옵션 조회 공용
LEGACY_FAMILYCARE_CONFIG_URL=     # 보험사/사고유형 옵션 조회 엔드포인트(운영팀이 별도 구축)
```

`legacy-webhook.gs`를 하나의 Apps Script Web App으로 배포했다면(3절),
`LEGACY_FAMILYCARE_WEBHOOK_URL`과 `LEGACY_FAMILYCARE_CONFIG_URL`을
**완전히 같은 URL**로 설정해도 된다.

## 8. 검증 시나리오

운영팀이 실제 Apps Script를 배포한 뒤 확인해야 할 시나리오(이 저장소는
직접 배포/실행하지 않으므로 코드/설계로만 이 흐름을 보장한다):

1. Google Form에 보험사 선택지 1개 추가 → 전자일지 코드 변경/재배포 없이
   다음 등록 화면부터 select에 반영(5분 캐시가 있으므로 최대 5분 지연
   가능, 2절 캐시 정책).
2. 보험사 선택지 1개 삭제 → 전자일지 select에서도 사라짐.
3. QR 신규 등록 → `E{YYMMDD}-{3자리}` 등록번호 생성 → 기존 Sheet에 1행
   추가(`action: "inserted"`) → `cases.legacy_sync_status = 'synced'`.
4. 같은 `registration_no`로 재전송(예: 관리자 [다시 전송]을 반복 클릭)
   → Sheet에 중복 행이 생기지 않음(`action: "duplicate"`, 여전히
   `ok:true`이므로 `synced`로 기록됨).
5. Apps Script Web App 배포를 일시 중단하거나 URL을 잘못 설정 → 전자일지
   QR 등록 자체는 여전히 성공 → `legacy_sync_status = 'failed'` →
   관리자 화면에서 [다시 전송] 가능.
6. Apps Script 복구 후 [다시 전송] → `synced`로 전환, Sheet에 중복 행
   없음.
7. Apps Script 편집기의 실행 로그(Logger)와 Vercel Runtime Log 어디에도
   주민등록번호/전화번호 원문이 출력되지 않음.

## 9. 이 저장소가 아직 확인하지 못한 것

- 실제 두 엔드포인트(등록 수신/옵션 조회) URL이 이 계약(3~5절)대로
  배포됐는지.
- 기존 Sheet의 실제 헤더 행이 `docs/legacy-family-care-field-map.md`
  1절의 28개 헤더와 정확히 일치하는지 — 하나라도 다르면
  `legacy-webhook.gs`의 `getHeaderMap_()`이 그 헤더를 못 찾아 해당
  컬럼만 조용히 비어서 저장된다(전체 실패는 아님, `등록번호` 헤더가
  없을 때만 명시적으로 실패 처리됨).
- `docs/legacy-family-care-field-map.md`에 남긴 필드명/값 형식 불확실
  항목 전체 — 특히 **"5. 확인 및 동의"는 실제 Google Form 응답 문자열을
  확인하기 전까지 payload에서 key 자체를 생략한다**(2026-08-23, 임의
  값 "동의함" 전송을 중단함). `legacy-webhook.gs`는 이 key가 없어도
  해당 셀을 그냥 빈 값으로 두고 정상 처리한다. 타임스탬프/종료일/비고
  전송 여부도 미확인.
- `HAPPYCARE_UPSERT_ON_DUPLICATE`를 켤지(재전송 시 기존 행 갱신) 끌지
  (기본값, 새 행 추가 안 함)는 운영 정책 결정 사항 — 이 저장소가 대신
  결정하지 않는다.
