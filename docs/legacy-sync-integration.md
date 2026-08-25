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

- ~~실제 두 엔드포인트(등록 수신/옵션 조회) URL이 이 계약(3~5절)대로
  배포됐는지.~~ **2026-08-24 확인 완료 — 10절 참고.**
- ~~기존 Sheet의 실제 헤더 행이 `docs/legacy-family-care-field-map.md`
  1절의 28개 헤더와 정확히 일치하는지.~~ **2026-08-24 실제 등록 1건으로
  일부 필드(보험사/사고유형/환자 생년월일/간병개시 예정일/타임스탬프)
  매핑 확인 완료 — 10.5절 참고. 나머지 헤더는 여전히 실제 트래픽으로
  개별 확인된 적 없음.**
- `docs/legacy-family-care-field-map.md`에 남긴 필드명/값 형식 불확실
  항목 전체 — 특히 **"5. 확인 및 동의"는 실제 Google Form 응답 문자열을
  확인하기 전까지 payload에서 key 자체를 생략한다**(2026-08-23, 임의
  값 "동의함" 전송을 중단함). `legacy-webhook.gs`는 이 key가 없어도
  해당 셀을 그냥 빈 값으로 두고 정상 처리한다. 타임스탬프/종료일/비고
  전송 여부도 미확인.
- `HAPPYCARE_UPSERT_ON_DUPLICATE`를 켤지(재전송 시 기존 행 갱신) 끌지
  (기본값, 새 행 추가 안 함)는 운영 정책 결정 사항 — 이 저장소가 대신
  결정하지 않는다.

---

## 10. 실제 운영 반영 이력 (2026-08-24)

이 절은 위 1~9절의 "설계 계약"이 실제로 운영에 반영되는 과정에서 겪은
장애와 그 해결, 그리고 그 결과 운영 DB/Apps Script에 실제로 존재하는
상태를 기록한다. 향후 동일한 장애가 재발하면 이 절부터 확인한다.

### 10.1 운영 DB 적용 이력 — 재실행 금지

아래 8개 객체는 **운영 DB에 이미 적용되어 있고, 실제 QR 등록 1건
(`E260824-002`)으로 끝까지(등록번호 채번 → Sheet 동기화) 동작이
검증됐다.** 관련 migration 파일을 다시 실행하지 않는다 — 이미 존재하는
객체에 대한 `create`/`alter`가 오류를 내거나(이미 존재), 의도치 않은
재정의를 일으킬 수 있다.

| 객체 | 적용한 파일 |
| --- | --- |
| `register_case_v3`(33 파라미터, `admission_status`/`insurance_company_other` 포함) | `supabase/migrations/20260823090000_legacy_sync_field_map.sql` |
| `generate_e_registration_no()` | `supabase/migrations/20260824090000_restore_e_registration_no_generator.sql`(hotfix) |
| `registration_no_counters` | 〃 |
| `cases.legacy_sync_status` | `supabase/migrations/20260824091000_restore_legacy_sync_columns.sql`(hotfix) |
| `cases.legacy_synced_at` | 〃 |
| `cases.legacy_sync_error` | 〃 |
| `cases.admission_status` | `supabase/migrations/20260823090000_legacy_sync_field_map.sql` |
| `cases.insurance_company_other` | 〃 |

`supabase/migrations/20260822090000_electronic_registration_no.sql`이
원래 이 객체들을 전부 만들도록 설계됐지만, 운영 DB에는 그 파일 단독
실행이 아니라 위 표의 파일들(+ hotfix 2건)이 합쳐진 결과로 반영되어
있다 — 즉 20260822 파일을 그대로 재실행하면 이미 존재하는 객체와
충돌할 수 있다.

### 10.2 장애 진단/해결 이력 — Apps Script 연동

실제 운영 반영 과정에서 순서대로 발견/해결한 문제들:

1. **Apps Script는 커스텀 요청 헤더를 못 읽는다** — 그래서 시크릿을
   헤더가 아니라 `POST` body의 `secret` 필드 / `GET` 쿼리 파라미터
   `?secret=`로 전달하는 구조로 처음부터 설계했다(1~2절). 실제 운영
   반영 중 이 설계가 그대로 맞았음을 재확인했다.
2. **`HAPPYCARE_SYNC_SECRET`(Apps Script Script Properties)과
   `LEGACY_FAMILYCARE_WEBHOOK_SECRET`(Vercel Production 환경변수)는
   반드시 완전히 동일한 값이어야 한다** — 실제 반영 중 이 값이 **두
   군데 모두에서 각각 별도로** 불일치를 일으켰다(아래 3, 이어서 Vercel
   쪽은 별도로 한 번 더). 두 값 중 하나만 바꾸고 다른 쪽을 잊는 실수가
   가장 흔한 실패 원인이므로, 시크릿을 교체할 때는 항상 양쪽을 함께
   갱신하고 양쪽 다 재확인한다.
3. **`secret_invalid` 진단 방법**: 실제 값을 출력하지 않고도 길이/문자
   구성(영문·숫자·기호 여부)/앞뒤 몇 글자의 문자 코드만 비교하는
   안전한 진단으로 "내가 보낸 값이 저장된 값과 다른지"를 확인할 수
   있다 — 이 방법으로 처음에는 로컬 셸(Git Bash/MSYS2)이 `/`로
   시작하는 시크릿 값을 자체적으로 손상시키던 문제였음을 찾아냈고
   (내 쪽 원인), 이후 별도로 Apps Script Script Properties에 저장된
   값 자체가 실제로 달랐던 것(운영 쪽 원인)도 같은 방법으로 구분해
   찾아냈다.
4. **`config_read_failed`(옵션 조회 실패) 원인 — Google Forms OAuth
   scope 누락**: Apps Script 프로젝트의 `appsscript.json`
   `oauthScopes`에 `https://www.googleapis.com/auth/forms`가 없으면
   `FormApp.openById(...)`가 예외를 던진다. `spreadsheets`/`drive`
   권한만으로는 부족하다.
5. **scope를 추가해도 재승인 팝업이 안 뜰 때**: 이미 폭넓게 권한을
   승인받은 오래된 Apps Script 프로젝트는 새로 추가된 scope 하나만으로
   재동의 화면을 다시 띄우지 않는 경우가 있다. 이때는
   `myaccount.google.com/permissions`에서 해당 Apps Script 프로젝트의
   기존 액세스 권한을 완전히 제거한 뒤, 인자 없는 진단 함수(예:
   `LegacySyncAuthorize.js`의 `authorizeLegacySyncScopes()`)를 편집기에서
   다시 실행하면 전체 권한을 새로 묻는 동의 화면이 뜬다.
6. **정상 승인 확인 기준**: `authorizeLegacySyncScopes()` 실행 로그
   (Logger)에 `spreadsheetOk=true`, `formOk=true`가 남으면 정상이다.
7. **`/api/registration-options` 정상 기준**: 응답이
   `ok: true`이고, `insuranceCompanies.length > 0`이며, `stale: false`
   여야 "지금 막 기존 시스템에서 최신 값을 성공적으로 받아왔다"로 볼 수
   있다(`stale: true`면 과거 성공 캐시를 대신 내려주는 중이라는 뜻 —
   2절 캐시 정책 참고).
8. **`register_case_v3` 실행 시 DB 선행 객체 누락 장애**: 위 10.1절의
   `generate_e_registration_no()`/`registration_no_counters`/
   `legacy_sync_status` 등 컬럼이 운영 DB에 없어 신규 QR 등록 자체가
   실패했다(각각 "function ... does not exist" / "column ... does not
   exist" 오류).
9. 위 8번은 hotfix migration 2건(10.1절 표)으로 복구 완료됐다 — 운영
   DB에 이미 적용되어 있다.
10. **SQL 재실행 주의**: 10.1절의 8개 객체는 모두 이미 존재한다. 관련
    migration 파일을 다시 실행하지 않는다.

### 10.3 Secret rotation 기록

- 2026-08-24: 기존 가족간병관리 연동 공유 시크릿(`HAPPYCARE_SYNC_SECRET`
  / `LEGACY_FAMILYCARE_WEBHOOK_SECRET`)을 새로 교체함.
- Apps Script Script Property, Vercel Production 환경변수 양쪽 모두
  갱신함.
- 실제 값은 의도적으로 어디에도 기록하지 않음(이 문서, 커밋 메시지,
  로그 전부 포함).

### 10.4 Apps Script 보조 스크립트

이 저장소 밖(Apps Script 프로젝트)에 있는 파일이라 이 저장소가 직접
관리하지 않지만, 향후 참고용으로 기록한다:

- `LegacySyncAuthorize.js` — 인자 없이 편집기에서 바로 실행할 수 있는
  OAuth 재승인용 진단 함수(10.2절 5, 6번). 향후 scope 추가/재승인이
  다시 필요할 때 재사용할 수 있으므로 **유지 권장**.
- `LegacySyncSetup.js` — 실제 사용처/트리거/참조가 없는 것으로 확인된
  일회성 설정 스크립트. clasp는 원격 파일을 삭제할 수 없어 이 저장소
  쪽 자동화로는 지울 수 없다 — **운영팀이 Apps Script 편집기에서 수동
  삭제할 후보**로만 기록해둔다(자동 삭제하지 않음).

### 10.5 E2E 검증 결과

2026-08-24, 실제 QR 등록 1건(`E260824-002`)으로 처음부터 끝까지 검증:
QR 등록 화면 → 등록 성공 표시 → `cases`에 신규 행 1건(상태 정상,
보험사 "삼성보험" 정상 반영) → `legacy_sync_status='synced'`(관리자
화면 "기존 시스템 연동: 완료" 배지로 확인) → 기존 Google Sheet에
동일 등록번호로 정확히 1행 추가, 보험사/사고유형/환자 생년월일/
간병개시 예정일/타임스탬프 필드 모두 정상 매핑, 중복 행 없음.

### 10.6 "처리상태" 신규 행 기본값 (2026-08-24)

기존 가족간병관리 시스템은 Sheet의 "처리상태" 컬럼이 "접수"여야 이후
알림톡 발송과 후속 자동화가 정상 동작한다. 이 값은 전자일지가 정하는
값이 아니므로(4절/`docs/legacy-family-care-field-map.md` "전송하지
않는 이유" 참고), **`lib/legacy-sync.ts`의 outbound payload에는 여전히
포함하지 않는다** — 대신 수신측 Apps Script의 `buildRowFromHeaderMap_`
(`docs/google-apps-script/legacy-webhook.gs`)이 **신규 행을 생성할
때만(`isUpdate=false`)** "처리상태" 컬럼에 "접수"를 직접 채운다.

- 신규 삽입(`action: "inserted"`): 처리상태="접수", 타임스탬프=현재시각
  (10.6절 대상, 6절 기존 동작과 함께 적용됨).
- 중복 수신(`HAPPYCARE_UPSERT_ON_DUPLICATE`가 기본값 `false`일 때,
  `action: "duplicate"`): 기존 행에 아무 것도 쓰지 않으므로 처리상태도
  그대로 유지된다(기존 동작 그대로, 변경 없음).
- 업데이트(`HAPPYCARE_UPSERT_ON_DUPLICATE="true"`일 때,
  `action: "updated"`): `buildRowFromHeaderMap_`이 업데이트 대상 행의
  현재 "처리상태" 셀 값을 다시 읽어 그대로 유지한다 — "완료"/"진행중"
  등 이미 진행 중인 업무 상태를 "접수"로 되돌리지 않는다. 현재 운영은
  `HAPPYCARE_UPSERT_ON_DUPLICATE="false"`라 이 경로는 실제로 쓰이지
  않지만, 향후 켜지더라도 안전하도록 미리 반영했다.
- 검토메모/종료일/비고/알림 4종/오류메모/"5. 확인 및 동의" 등 다른
  후속관리 컬럼은 이번 변경과 무관하다 — 신규/재전송 어느 경로에서도
  전자일지가 임의 값을 채우지 않는 기존 정책을 그대로 유지한다.
- 이 변경은 아직 실제 Apps Script 프로젝트에 배포되지 않았다 — 문서/
  코드 수정 및 로컬 검증까지만 완료된 상태.

### 10.7 Sheet 전화번호 표시 형식 (2026-08-24)

**Supabase 내부 전화번호 정규화 형식과 기존 가족간병관리 Sheet 표시
형식은 분리한다.** `caregivers.phone_normalized`(OTP/Solapi/세션
조회에 쓰는 E.164 값, `lib/phone.ts`의 `toE164()`)와 Sheet에 실제로
표시되는 "010-1234-5678" 문자열은 서로 다른 목적의 값이며, 이 절의
변경은 Sheet 표시값에만 영향을 준다 — Supabase에 저장된 어떤 전화번호
컬럼도 이 변경으로 바뀌지 않는다.

**증상**: 간병인 연락처는 Sheet에 "82010..."처럼 국가번호가 붙은 채로,
환자/설계사 연락처는 맨 앞자리 "0"이 빠진 채로 기록됐다.

**원인 (코드로 확인, 2026-08-24)**:
- Apps Script 코드 자체에는 `Number()`/`parseInt()` 등 숫자 변환이
  전혀 없다 — 문제는 Google Sheets가 `setValues()`/`appendRow()`로
  들어오는, 숫자로만 이루어진 문자열을 자동으로 숫자로 인식해 맨 앞의
  "+"나 "0"을 지워버리는 동작이다.
- **간병인 연락처**: `register_case_v3`(`supabase/migrations/
  20260823090000_legacy_sync_field_map.sql` 181~195행)가 신규 간병인을
  만들 때 `phone`과 `phone_normalized` 두 컬럼에 **같은 값**
  (`p_caregiver_phone_normalized`, 즉 `toE164()`를 거친 E.164 값
  "+8210...")을 넣는다. `lib/legacy-sync.ts`는 `caregivers.phone`을
  그대로 읽어 payload에 담으므로, legacy-sync 단계에 도달하기 전에
  이미 "+8210..." 형태다. `docs/data-model.md`가 설명하는 "phone은
  레거시 원본 형식" 전제는 이 경로(`register_case_v3`)에는 더 이상
  맞지 않는다 — Sheets에 그대로 쓰면 "+"가 사라지고 숫자만 남아
  "82010..."으로 보인다.
- **환자/설계사 연락처**: `cases.patient_phone`/`cases.planner_phone`은
  등록 화면에 입력한 문자열을 변환 없이 그대로 저장·전송한다
  (`app/case-register/CaseRegisterClient.tsx`의 입력창은 자동
  하이픈 포맷 없이 순수 텍스트 입력이다) — 사용자가 하이픈 없이
  "01012345678"처럼 입력하면 그 형태 그대로 Sheet까지 전달되고,
  Sheets가 이를 숫자로 인식해 맨 앞 "0"이 사라진다.
- 즉 두 증상 모두 **Sheets의 자동 숫자 인식**이 공통 원인이고,
  간병인 연락처는 여기에 더해 "Supabase에 이미 E.164로 저장돼 있다"는
  선행 요인이 겹친 것이다.

**수정**: `docs/google-apps-script/legacy-webhook.gs`에
`formatPhoneForSheet_()`를 추가하고, `buildRowFromHeaderMap_`이 "간병인
연락처"/"환자 연락처"/"설계사 연락처" 3개 컬럼에 한해 이 함수를 거친
값을 Sheet 행에 쓴다. 이 함수는 입력이 "+8210...", "8210...",
"010...", "010-...-...." 중 무엇이든 국내 휴대폰 번호 패턴이면
"010-1234-5678" 형식으로 통일하고, 패턴에 맞지 않는 값(전화번호가
아니거나 형식이 불확실한 값)은 임의로 추측해 바꾸지 않고 원본 그대로
둔다. `lib/legacy-sync.ts`와 Supabase 저장값은 변경하지 않았다 — 오직
Apps Script가 Sheet 셀에 쓰는 표시 문자열만 변환한다.

**알려진 한계**: 하이픈이 아예 없는 국내 휴대폰 패턴 외의 숫자 문자열
(예: 유선번호를 하이픈 없이 입력한 경우)은 이 함수가 원본을 그대로
반환하므로, 여전히 Sheets가 숫자로 잘못 인식할 수 있다 — 이번 변경
범위는 국내 휴대폰 번호(010/011/016/017/018/019)로 한정한다.

### 10.8 접수 처리/알림톡 — Google Form과 전자일지 공통 함수 (2026-08-24)

**증상**: 전자일지 QR 등록 건은 Sheet에 정상 반영(처리상태="접수" 포함)
되는데도, 기존 가족간병관리 시스템의 접수 알림톡이 발송되지 않았다.

**원인**: 접수 알림톡은 `Code.js`의 `onFormSubmit(e)`에서만 실행된다.
이 함수는 스프레드시트에 등록된 **설치형 "양식 제출 시(On form
submit)" 트리거**이며, 이 트리거 유형은 실제 Google Form 제출
이벤트에만 반응하도록 플랫폼 차원에서 고정되어 있다 — 전자일지의
`doPost`가 `SpreadsheetApp`으로 직접 `appendRow()`해서 행을 추가해도
(같은 Apps Script 프로젝트 안에서 실행되더라도) 이 트리거는 발동하지
않는다. 그 결과 전자일지 등록 건은 `처리상태="접수"`까지는
`buildRowFromHeaderMap_`이 채우지만, 그 값을 신호로 알림을 보내는
유일한 진입점이 아예 호출되지 않았다.

**수정**: 알림톡 로직을 복제하지 않고, 기존 `onFormSubmit(e)`의
검증된 본문을 `processReceptionRow_(sheet, row)`로 그대로 추출해
Google Form 경로와 전자일지 경로가 **같은 함수**를 호출하도록
연결했다.

```
Google Form:
  Form 제출
  → (Forms-Sheets 연동이 응답 행을 Sheet에 추가)
  → "양식 제출 시" 설치형 트리거 발동
  → onFormSubmit(e)
  → processReceptionRow_(sheet, row)
  → 등록번호 채번(없으면)/처리상태="접수"/전화번호 정규화/접수
    알림톡(보호자·설계사)/직원 알림

전자일지:
  legacy webhook doPost
  → (신규 등록번호 → Sheet에 새 행 INSERT, action:"inserted")
  → processReceptionRow_(sheet, 방금 추가된 행 번호)  ← Form과 동일 함수
  → 위와 동일한 접수 처리/알림톡 로직 실행
```

- **duplicate**(`HAPPYCARE_UPSERT_ON_DUPLICATE`가 기본값 `false`일 때
  동일 등록번호 재수신): `processReceptionRow_`를 호출하지 않는다 —
  기존 행에 아무 것도 쓰지 않으므로 접수 알림도 재발송되지 않는다.
- **update**(`HAPPYCARE_UPSERT_ON_DUPLICATE="true"`일 때): 이 경로도
  `processReceptionRow_`를 호출하지 않는다 — 처리상태는 10.6절대로
  기존 값을 보존하고, 접수 알림도 다시 보내지 않는다.
- **신규 INSERT일 때만** 정확히 1회 호출된다.

**행 번호 동시성**: `appendRow()` 이후 별도로 `getLastRow()`를 호출해
"방금 추가한 행 번호"를 얻는 방식은, 그 사이 동시 요청이 다른 행을
추가하면 남의 행 번호를 잘못 잡을 위험이 있다. `doPost`는 중복검사 →
행 쓰기 → 행 번호 확정 구간 전체를 `LockService.getScriptLock()`으로
감싸 이 위험을 없앴다. `processReceptionRow_`(구 `onFormSubmit` 본문)
자신도 동일한 스크립트 락을 내부에서 획득하므로, `doPost`는 이 락을
**먼저 해제한 뒤** `processReceptionRow_`를 호출한다 — 같은 실행
안에서 같은 락을 중첩 획득하려다 생길 수 있는 위험을 구조적으로
피하기 위함이다(같은 실행 내 재진입 시 Apps Script의 실제 동작이
불확실해 추측으로 중첩 lock을 두지 않았다).

**알림 실패와 Sheet 동기화 성공을 분리**: Sheet 행 저장(=전자일지
기준 "동기화 성공")과 접수 알림톡 발송 성공은 별개다.
`processReceptionRow_` 내부는 기존 Google Form 경로와 동일하게 알림
실패 시 "오류메모"에 기록하고 예외를 다시 던지는 구조를 그대로
유지한다(이 내부 구조는 바꾸지 않았다). 다만 `doPost`는 이
`processReceptionRow_` 호출을 별도 `try/catch`로 감싸, 예외가
`doPost` 응답까지 전파되지 않게 한다 — 그렇지 않으면 Apps Script
Web App이 예외로 인해 비정상 응답(비-JSON/5xx)을 돌려주고,
`lib/legacy-sync.ts`가 이를 `http_5xx`/`invalid_response`로 오인해
**Sheet 행이 이미 정상 저장됐는데도** `cases.legacy_sync_status`가
`'failed'`로 잘못 기록될 수 있었다. 이 예외 처리 덕분에 알림톡
실패는 Sheet의 "오류메모"/`접수알림_보호자`·`접수알림_설계사`
컬럼(값이 "Y"가 아니면 미발송)으로만 남고, `doPost`는 여전히
`{ok:true, action:"inserted"}`를 반환해 `legacy_sync_status='synced'`로
정상 기록된다.

**ALIMTALK_TEST_MODE**: `Code.js`의 `isAlimtalkTestMode_()`는 Script
Property `ALIMTALK_TEST_MODE`를 trim 후 대문자로 변환해 정확히
`"TRUE"`와 비교한다(대소문자 무관, 앞뒤 공백 무관 — 예:
`"true"`/`" True "` 모두 유효). 이 값이 켜져 있으면
`sendSolapiVariablesAlimtalk_`가 실제 SOLAPI `UrlFetchApp.fetch()`
호출 전에 즉시 테스트 결과를 반환한다 — 실배포 전 검증에 활용할 수
있다.

**전화번호 formatter 중복(알려진 사항, 이번엔 미정리)**: `Code.js`의
`formatPhoneForResponse_()`(Google Form 경로)와 `legacy-webhook.gs`의
`formatPhoneForSheet_()`(전자일지 경로, 10.7절)가 기능이 일부
겹친다. `processReceptionRow_` 재사용 후에도 두 함수가 순서대로
적용되지만(전자일지가 먼저 하이픈 형식으로 쓰고, 그 위에 Form 경로의
포맷터가 다시 적용되어도 결과가 같음, 멱등) 결과에 문제가 없어
이번에는 통합하지 않았다 — 향후 별도 리팩터링 대상으로만 기록한다.

### 10.9 `Code.js` 의존성 — Git에 없는 운영 코드에 대한 계약 기록 (2026-08-25)

**중요한 구조적 사실**: `legacy-webhook.gs`의 `doPost`(신규 INSERT
경로)는 이제 전역 함수 `processReceptionRow_(sheet, row)`가 **같은
Apps Script 프로젝트 안에 존재한다는 것을 전제**로 동작한다. 이
함수는 `Code.js`(운영팀이 원래부터 관리해 온 파일)에 있고,
**`Code.js`는 이 저장소(git)에 전혀 tracked되지 않는다** — 이 저장소는
처음부터 `docs/google-apps-script/legacy-webhook.gs`(수신 webhook
계약)만 문서로 갖고, Google Form/알림톡/서류 자동화 전체(`Code.js`,
`Common.js` 등)는 의도적으로 소유 범위 밖에 둬 왔다.

그 결과, 만약 누군가 `Code.js`를 예전 버전으로 되돌리거나 새로
덮어쓰면(이 저장소가 인지할 방법이 없음), `doPost`는
`processReceptionRow_ is not defined`로 실패하고 — 그 실패는
`doPost` 안의 `try/catch`가 삼키므로(10.8절 "알림 실패와 Sheet 동기화
성공 분리") **`action:"inserted"` 응답 자체는 계속 정상으로 보이지만
접수 알림톡만 조용히 전혀 발송되지 않는** 상태가 될 수 있다 — 겉으로
드러나지 않는 위험이라 별도로 기록해 둔다.

**이번에 남기는 최소 안전장치**: `Code.js` 전체를 이 저장소에
새로 편입하지는 않는다(범위 밖 자동화 전체를 끌어오는 것은 이번
작업 범위를 넘어선다). 대신 이 계약이 의존하는 두 함수
(`onFormSubmit`/`processReceptionRow_`)의 **현재 스냅샷**만 참고용으로
남긴다 — 실제 정본(source of truth)은 여전히 운영 Apps Script
프로젝트의 `Code.js`이며, 이 스냅샷은 그 파일이 사라지거나 되돌아갔을
때 무엇을 복원해야 하는지 알 수 있게 하는 기록일 뿐 자동 동기화되지
않는다.

```js
// Code.js (운영 Apps Script 프로젝트, 이 저장소 밖) — 2026-08-25 스냅샷.
// 정본이 아님 — 실제 코드는 Apps Script 프로젝트에서 확인할 것.
function onFormSubmit(e) {
  return processReceptionRow_(
    e.range.getSheet(),
    e.range.getRow()
  );
}

function processReceptionRow_(sheet, row) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // 등록번호 채번(없으면 createReceiptNo_)/처리상태="접수"/전화번호
    // 정규화(addNormalizedPhoneUpdates_)/접수 알림톡(sendSolapiAlimtalk_,
    // 보호자·설계사)/직원 알림(sendStaffNotification_) — 전체 본문은
    // 운영 Apps Script 프로젝트 Code.js 참고.
  } catch (err) {
    setCellByHeader_(sheet, row, "오류메모", err.message);
    throw err;
  } finally {
    lock.releaseLock();
  }
}
```

향후 이 함수가 이 저장소 밖에서 다시 크게 바뀌면, 이 절도 함께
갱신해야 한다.

### 10.10 실제 QR 등록 E2E 결과 (2026-08-25, ALIMTALK_TEST_MODE=FALSE)

`E260825-001` 1건으로 알림톡 공통화 이후 첫 실배포 검증 완료 — Sheet
동일 등록번호 정확히 1행, 처리상태="접수", 간병인/환자/설계사 연락처
모두 정상 형식(010-XXXX-XXXX), 접수알림_보호자="Y", 접수알림_설계사="Y",
오류메모 없음. 사용자가 보호자·설계사 알림톡을 실제로 수신했음을
확인함 — Google Form 경로와 전자일지 경로가 `processReceptionRow_`를
공유하는 구조가 실제 운영에서 정상 동작함을 검증했다.

### 10.11 간병인 주민등록번호 Sheet 표시 형식 (2026-08-25)

**증상**: 간병인 주민등록번호가 기존 가족간병관리 Sheet에 하이픈 없이
13자리 숫자로만 저장됨 — 기존 표시 형식("900101-1234567")과 다름.

**원인**: `caregivers`에는 원래부터 하이픈 없는 순수 13자리 숫자만
암호화되어 저장된다(등록 화면에서 `normalizeResidentNumber()`가 먼저
하이픈을 제거한 뒤 암호화). `lib/legacy-sync.ts`는 전송 직전 이
값을 복호화한 뒤 **형식 변환 없이 그대로** payload에 넣고 있었다.

**수정**: 새 formatter를 만들지 않고, 화면 입력 검증에 이미 쓰고 있는
`lib/registration-validation.ts`의 `formatResidentNumberWithHyphen()`을
`lib/legacy-sync.ts`가 payload를 구성하는 시점(복호화 직후, 전송
직전)에 그대로 재사용한다. 이미 하이픈이 있으면(13자리가 아니게 되므로)
원본을 그대로 반환해 중복 하이픈이 생기지 않는다. 13자리가 아닌 값은
임의로 추측/보정하지 않고 원본 그대로 전송한다.

**적용 위치를 legacy-sync.ts로 정한 이유**: 복호화(평문 노출)가
이미 이 파일의 이 지점(서버 전용 경계, 전송 직전)에서만 일어나도록
설계돼 있다(6절 개인정보 처리 원칙). Apps Script 쪽에서 원문을 다시
가공하게 하면 평문이 노출되는 지점이 하나 더 늘어나는 셈이라, 기존
경계를 그대로 유지하는 이 위치가 더 안전하다고 판단했다. DB
저장값(암호문)/로그/case_history/관리자 화면 노출 범위는 전혀
바뀌지 않았다.

### 10.12 "현재상태"(admission_status) — 조사 진행 중 (2026-08-25)

`app/case-register/CaseRegisterClient.tsx`(UI 선택값) →
`app/api/cases/register/route.ts`(`p_admission_status`) →
`supabase/migrations/20260823090000_legacy_sync_field_map.sql`의
`register_case_v3`(INSERT 컬럼/VALUES 정렬 확인) → `lib/legacy-sync.ts`
(`현재상태: caseRow.admission_status`, SELECT 목록에 `admission_status`
포함 확인) → `legacy-webhook.gs`의 `buildRowFromHeaderMap_`(헤더
목록에 "현재상태" 포함, 특별 제외 없음) — **이 저장소 코드는 4단계
전부 정적으로 확인했고 문제를 찾지 못했다.**

**중간 확인 결과(2026-08-25)**: Supabase SQL Editor에서
`select registration_no, admission_status from public.cases where
registration_no = 'E260825-001'`를 실행한 결과는 `admission_status =
NULL`이 아니라 **"Success. No rows returned"(행 자체가 없음)** 이었다
— 이 둘은 원인이 완전히 다르므로 반드시 구분한다. `registration_no`가
Sheet에 존재한다고 해서 `cases.registration_no`에도 같은 값이 있다고
가정하지 않는다 — Sheet의 "등록번호" 값은 `lib/legacy-sync.ts`가
`caseRow.registration_no`(요청 시점에 DB에서 다시 조회한 값)를 그대로
보낸 것이므로, 동기화가 성공했다면 **그 시점에는** 해당
`registration_no`를 가진 `cases` 행이 존재했어야 한다는 논리적 근거는
있다 — 그런데도 지금 조회에서 행 자체가 없다면, 가장 유력한 설명은
**SQL Editor가 Production이 실제로 쓰는 것과 다른 Supabase
프로젝트를 보고 있다는 것**이다. Vercel Production이 실제로 쓰는
Supabase 프로젝트 호스트명은 공개 배포 번들에서 직접 확인했다
(`NEXT_PUBLIC_SUPABASE_URL`이라 비밀값이 아님) —
`abayfpcmdfpjkewseaha.supabase.co`. 사용자의 SQL Editor가 연 프로젝트의
호스트명/project ref가 이것과 같은지 확인이 필요하다(완료 보고 참고).
이 프로젝트는 과거에도 마이그레이션 파일과 실제 운영 DB에 적용된 함수
본문이 서로 다른 사례(10.1절)가 있었으므로 그 가능성도 완전히
배제하지는 않지만, "행 없음"이라는 이번 결과 자체는 프로젝트 불일치
쪽 설명과 더 맞는다. SQL 실행이 금지되어 있어 이 저장소 쪽에서는 더
확인하지 못했다.

### 10.13 "5. 확인 및 동의" 활성화 (2026-08-25)

기존 Google Form으로 실제 정상 등록된 행에서 확인한 실제 Sheet 저장
문자열을 `lib/legacy-sync.ts`의 `LEGACY_CONSENT_RESPONSE` 상수로
등록했다(2절 참고, 문서 밖에 값을 반복하지 않도록 이 상수 하나만
참조). `case_consents` 6개 항목을 전송 직전 다시 조회해 모두 true일
때만 이 문자열을 채우고, 하나라도 false면(정상 등록 흐름에서는 발생하지
않음) `null`을 보낸다 — 과거 임시로 썼던 `"동의함"` 같은 임의 값은
다시 쓰지 않았다. `case_consents` 저장 구조/검증 로직은 변경하지
않았다.
