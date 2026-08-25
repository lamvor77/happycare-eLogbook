/**
 * 기존 가족간병관리 시스템 수신용 Google Apps Script — 참고/배포용 예제 코드.
 *
 * 이 파일은 이 저장소(전자일지) 안에 "문서"로만 존재한다. 실제 배포는
 * 운영팀이 Google Apps Script 프로젝트를 만들어 이 코드를 붙여넣고
 * Web App으로 배포해야 한다(이 저장소/전자일지 쪽에서는 배포할 수 없다).
 * 설정 절차는 docs/legacy-sync-integration.md "운영 설정 절차" 참고.
 *
 * 역할 2가지 (같은 Web App URL 하나로 둘 다 처리 가능 — 아래 "URL 하나로
 * 충분한 이유" 참고):
 *   1. doPost(e) — 전자일지 QR 최초 등록 완료 시 lib/legacy-sync.ts가
 *      보내는 등록정보를 기존 가족간병관리 Google Sheet에 한 행 추가한다.
 *   2. doGet(e)  — 전자일지 등록 화면(GET /api/registration-options)이
 *      기존 Google Form의 "보험사" 질문 현재 선택지를 조회한다.
 *
 * ── 왜 시크릿이 헤더가 아니라 body/쿼리 파라미터에 있는가 ──────────────
 * Google Apps Script Web App의 doGet(e)/doPost(e)는 커스텀 HTTP 요청
 * 헤더를 읽을 방법이 없다(e 객체에는 parameter/parameters/postData/
 * queryString/contextPath만 있고 headers가 없음 — Apps Script의 알려진
 * 플랫폼 제약). 그래서:
 *   - POST(등록 수신): 시크릿을 JSON body의 "secret" 필드로 받는다.
 *   - GET(옵션 조회): 시크릿을 쿼리 파라미터 ?secret=...로 받는다.
 * 전자일지 쪽(lib/legacy-sync.ts, lib/legacy-registration-options.ts)도
 * 이 방식에 맞춰 구현되어 있다 — x-legacy-sync-secret 헤더도 함께 보내긴
 * 하지만(다른 서버로 교체될 경우 대비, 무해함), Apps Script는 그 헤더를
 * 아예 볼 수 없으므로 실제 인증은 body/쿼리 파라미터로만 판단한다.
 *
 * ── URL 하나로 충분한 이유 ──────────────────────────────────────────
 * Apps Script Web App은 doGet과 doPost를 HTTP 메서드로 자동 라우팅한다.
 * 즉 같은 배포 URL에 GET으로 요청하면 doGet(e)(보험사 옵션 조회)가,
 * POST로 요청하면 doPost(e)(등록 수신)가 실행된다 — action 파라미터 같은
 * 추가 분기 없이도 LEGACY_FAMILYCARE_WEBHOOK_URL과
 * LEGACY_FAMILYCARE_CONFIG_URL을 완전히 동일한 값으로 설정해도 된다.
 *
 * ── Script Properties (Apps Script 프로젝트 설정 → 스크립트 속성) ───────
 *   HAPPYCARE_SYNC_SECRET       공유 시크릿(LEGACY_FAMILYCARE_WEBHOOK_SECRET과 동일 값)
 *   HAPPYCARE_SPREADSHEET_ID    대상 Google Sheet의 스프레드시트 ID
 *   HAPPYCARE_SHEET_NAME        대상 시트(탭) 이름 — 비우면 첫 번째 시트 사용
 *   HAPPYCARE_FORM_ID           보험사 선택지를 읽어올 Google Form ID
 *   HAPPYCARE_UPSERT_ON_DUPLICATE  "true"면 중복 등록번호를 기존 행 업데이트로
 *                                   처리(선택, 기본은 "새 행 추가 안 함"만 함)
 * 스프레드시트 ID/시크릿을 코드에 하드코딩하지 않는다 — 전부 Script
 * Properties에서 읽는다.
 *
 * ── 개인정보/로그 원칙 ────────────────────────────────────────────
 *   - Logger.log에 주민등록번호/전화번호/요청 body 전체를 절대 남기지 않는다.
 *   - 실패해도 안전한 코드 문자열만 로그/응답에 남긴다(스택트레이스 금지).
 *   - 응답 JSON에도 개인정보를 절대 포함하지 않는다(등록번호/action/error만).
 */

// ============================================================================
// 등록 수신 (POST) — 전자일지 → 이 Sheet
// ============================================================================

function doPost(e) {
  var body;

  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse_({ ok: false, error: "invalid_json" });
  }

  var expectedSecret = getScriptProperty_("HAPPYCARE_SYNC_SECRET");

  if (!expectedSecret || body.secret !== expectedSecret) {
    // body.secret 값 자체는 로그에 남기지 않는다.
    return jsonResponse_({ ok: false, error: "secret_invalid" });
  }

  var registrationNo = body["등록번호"];

  if (!registrationNo || String(registrationNo).trim() === "") {
    return jsonResponse_({ ok: false, error: "missing_registration_no" });
  }

  var sheet;
  try {
    sheet = getTargetSheet_();
  } catch (err) {
    return jsonResponse_({ ok: false, error: "sheet_not_found" });
  }

  var headerMap = getHeaderMap_(sheet);

  if (!headerMap["등록번호"]) {
    // 헤더 1행에 "등록번호" 컬럼이 없으면 어느 컬럼에 뭘 써야 할지 알 수
    // 없다 — 하드코딩된 열 번호로 대체하지 않고 그대로 실패시킨다.
    return jsonResponse_({ ok: false, error: "header_not_found" });
  }

  // 중복검사 -> 신규 행번호 결정 -> 행 쓰기 구간을 스크립트 락으로
  // 보호한다. appendRow() 뒤에 별도로 getLastRow()를 호출해 "방금 내가
  // 추가한 행 번호"를 얻는 방식은, 그 사이 동시 요청이 다른 행을
  // 추가하면 남의 행 번호를 잘못 잡을 위험이 있다 - 이 구간 전체를
  // 잠가 그 위험을 없앤다. processReceptionRow_ 호출은 이 락을 푼
  // 뒤에 한다 - processReceptionRow_ 자신도 동일한
  // LockService.getScriptLock()을 내부에서 획득하므로(Code.js,
  // 기존 onFormSubmit 본문 그대로 이동), 이 락을 쥔 채로 호출하면
  // 같은 실행 안에서 같은 락을 다시 얻으려 시도하게 된다 - 락을
  // 먼저 풀고 순차적으로 호출해 그 위험 자체를 구조적으로 피한다.
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  var action;
  var newRowNumber = null;

  try {
    var existingRowNumber = findRowByRegistrationNo_(sheet, headerMap, registrationNo);
    var upsertOnDuplicate = getScriptProperty_("HAPPYCARE_UPSERT_ON_DUPLICATE") === "true";

    if (existingRowNumber) {
      if (!upsertOnDuplicate) {
        // 기본 동작: 같은 등록번호면 새 행을 추가하지 않는다(중복 방지).
        // 재전송(관리자 [다시 전송])이 몇 번 와도 안전하다. 접수
        // 알림톡도 다시 보내지 않는다(processReceptionRow_ 호출 없음).
        action = "duplicate";
      } else {
        var rowValues = buildRowFromHeaderMap_(sheet, headerMap, body, /* isUpdate */ true, existingRowNumber);
        sheet.getRange(existingRowNumber, 1, 1, rowValues.length).setValues([rowValues]);
        // update 경로도 접수 알림톡을 다시 보내지 않는다(처리상태 등
        // 기존 값 보존, processReceptionRow_ 호출 없음).
        action = "updated";
      }
    } else {
      var newRow = buildRowFromHeaderMap_(sheet, headerMap, body, /* isUpdate */ false);
      sheet.appendRow(newRow);
      newRowNumber = sheet.getLastRow();
      action = "inserted";
    }
  } finally {
    lock.releaseLock();
  }

  if (action === "inserted" && newRowNumber) {
    // 신규 삽입일 때만 기존 접수 처리/알림톡 로직을 실행한다(Code.js
    // processReceptionRow_ - Google Form 경로와 완전히 동일한 함수를
    // 재사용, 새로 만들거나 복제하지 않음).
    try {
      processReceptionRow_(sheet, newRowNumber);
    } catch (err) {
      // 접수 알림톡 실패가 Sheet 동기화 자체의 실패로 오판되지 않게
      // 한다 - Sheet 행은 이미 위에서 정상적으로 추가됐다. 실패
      // 사실은 processReceptionRow_ 내부에서 이미 "오류메모"/알림
      // 컬럼으로 기록한다(기존 Form 경로와 동일한 처리) - 여기서는
      // 그 예외가 doPost 응답까지 전파되어
      // cases.legacy_sync_status가 잘못 'failed'로 기록되지
      // 않도록 삼키기만 한다.
    }
  }

  return jsonResponse_({ ok: true, registration_no: registrationNo, action: action });
}

// ============================================================================
// 보험사/사고유형 옵션 조회 (GET) — 전자일지 등록 화면 → 이 Form
// ============================================================================

function doGet(e) {
  var expectedSecret = getScriptProperty_("HAPPYCARE_SYNC_SECRET");
  var providedSecret = e.parameter ? e.parameter.secret : null;

  if (!expectedSecret || providedSecret !== expectedSecret) {
    return jsonResponse_({ ok: false, error: "secret_invalid" });
  }

  try {
    var insuranceCompanies = getInsuranceCompanyChoices_();

    return jsonResponse_({
      ok: true,
      insurance_companies: insuranceCompanies,
      // 사고유형은 실제 운영값(질병/상해/교통사고)이 이미 확인되어 있다.
      // Form에 동일한 이름의 질문이 있으면 그 값을 우선 쓰고, 없으면 이
      // 고정값을 그대로 반환한다 — 전자일지 쪽도 이 값을 그대로 쓰거나
      // 실패 시 자체 고정값으로 대체한다(둘 다 임의 목록을 지어내지 않음).
      accident_types: getAccidentTypeChoices_(),
    });
  } catch (err) {
    return jsonResponse_({ ok: false, error: "config_read_failed" });
  }
}

/**
 * Google Form에서 title이 정확히 "보험사"인 질문의 현재 선택지를 그대로
 * 반환한다. 객관식(MultipleChoiceItem)/드롭다운(ListItem)/체크박스
 * (CheckboxItem) 세 타입을 지원한다. 코드에 보험사 이름을 하드코딩하지
 * 않는다 — 질문을 못 찾거나 Form ID가 설정되지 않으면 빈 배열을 반환한다.
 */
function getInsuranceCompanyChoices_() {
  return getFormChoicesByTitle_("보험사");
}

/**
 * 사고유형 질문이 Form에 있으면 그 선택지를 우선 사용하고, 없으면 빈
 * 배열을 반환한다(호출부인 doGet이 실패로 취급하지 않고, 전자일지 쪽
 * 고정값으로 대체됨).
 */
function getAccidentTypeChoices_() {
  var choices = getFormChoicesByTitle_("사고유형");
  return choices.length > 0 ? choices : ["질병", "상해", "교통사고"];
}

function getFormChoicesByTitle_(title) {
  var formId = getScriptProperty_("HAPPYCARE_FORM_ID");

  if (!formId) {
    return [];
  }

  var form = FormApp.openById(formId);
  var items = form.getItems();

  for (var i = 0; i < items.length; i++) {
    var item = items[i];

    if (item.getTitle().trim() !== title) {
      continue;
    }

    var type = item.getType();

    if (type === FormApp.ItemType.MULTIPLE_CHOICE) {
      return mapChoiceValues_(item.asMultipleChoiceItem().getChoices());
    }

    if (type === FormApp.ItemType.LIST) {
      return mapChoiceValues_(item.asListItem().getChoices());
    }

    if (type === FormApp.ItemType.CHECKBOX) {
      return mapChoiceValues_(item.asCheckboxItem().getChoices());
    }
  }

  return [];
}

function mapChoiceValues_(choices) {
  var values = [];

  for (var i = 0; i < choices.length; i++) {
    values.push(choices[i].getValue());
  }

  return values;
}

// ============================================================================
// Sheet 헬퍼 — 헤더 1행 이름 기준으로만 동작한다(열 번호 하드코딩 금지)
// ============================================================================

function getTargetSheet_() {
  var spreadsheetId = getScriptProperty_("HAPPYCARE_SPREADSHEET_ID");

  if (!spreadsheetId) {
    throw new Error("HAPPYCARE_SPREADSHEET_ID not set");
  }

  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  var sheetName = getScriptProperty_("HAPPYCARE_SHEET_NAME");
  var sheet = sheetName ? spreadsheet.getSheetByName(sheetName) : spreadsheet.getSheets()[0];

  if (!sheet) {
    throw new Error("sheet not found");
  }

  return sheet;
}

/** 헤더 1행을 읽어 {헤더명: 1-based 열 번호} 맵을 만든다. */
function getHeaderMap_(sheet) {
  var lastColumn = sheet.getLastColumn();

  if (lastColumn < 1) {
    return {};
  }

  var headerRow = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var map = {};

  for (var i = 0; i < headerRow.length; i++) {
    var header = String(headerRow[i]).trim();

    if (header) {
      map[header] = i + 1;
    }
  }

  return map;
}

/** "등록번호" 컬럼에서 정확히 일치하는 값을 찾아 시트 행 번호(2부터)를 반환한다. */
function findRowByRegistrationNo_(sheet, headerMap, registrationNo) {
  var column = headerMap["등록번호"];

  if (!column) {
    return null;
  }

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return null;
  }

  var values = sheet.getRange(2, column, lastRow - 1, 1).getValues();

  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === String(registrationNo).trim()) {
      return i + 2;
    }
  }

  return null;
}

/**
 * 헤더 1행에 존재하는 컬럼 중, body(JSON payload)에 같은 이름의 키가 있는
 * 값만 채운 배열을 만든다. body에 없는 헤더(검토메모, 종료일, 비고,
 * 접수알림_보호자, 접수알림_설계사, 등록완료알림_보호자,
 * 등록완료알림_설계사, 오류메모, "5. 확인 및 동의" 등 이번 단계에서
 * 전자일지가 보내지 않는 후속관리 컬럼, 작업 H)는 빈 문자열로 남겨 기존
 * Sheet의 기본 처리(수식 등)에 맡긴다 — 값을 임의로 채우지 않는다.
 * "타임스탬프"는 body에 없을 것이 확실하므로(전자일지가 보내지 않음)
 * 신규 삽입 시에만 이 함수가 현재 시각으로 채운다.
 *
 * "처리상태"는 위 후속관리 컬럼과 달리 예외로 취급한다 — 신규 삽입
 * (isUpdate=false)일 때만 "접수"를 기본값으로 채운다. 기존 가족간병관리
 * 시스템은 이 값이 "접수"여야 이후 알림톡/후속 자동화가 정상 동작하기
 * 때문이다(전자일지가 이 값을 payload로 보내는 것이 아니라, 신규 행을
 * 만드는 이 함수가 직접 채운다). 재전송으로 인한 update(isUpdate=true,
 * HAPPYCARE_UPSERT_ON_DUPLICATE="true"일 때만 발생)에서는 이미 진행 중인
 * 업무 상태("완료"/"진행중" 등)를 "접수"로 되돌리지 않도록, existingRow의
 * 현재 셀 값을 그대로 유지한다. (같은 이유로 검토메모/종료일/비고 등
 * 다른 후속관리 컬럼도 update 시 이론상 빈 값으로 덮일 수 있지만, 현재
 * 운영은 HAPPYCARE_UPSERT_ON_DUPLICATE="false"라 update 경로 자체가
 * 쓰이지 않으므로 이번 변경 범위에 포함하지 않는다.)
 *
 * "간병인 연락처"/"환자 연락처"/"설계사 연락처" 3개 컬럼은 body 값을
 * 그대로 쓰지 않고 formatPhoneForSheet_()를 거친다 - 전자일지가 보내는
 * 전화번호 형식이 필드마다 다르고(간병인은 E.164 "+8210...", 환자/설계사는
 * 화면에 입력한 원본 그대로 "010...", "010-...." 등 혼재), 숫자로만
 * 이루어진 문자열을 Google Sheets의 setValues()/appendRow()에 그대로
 * 넘기면 Sheets가 이를 숫자로 자동 인식해 맨 앞의 "+"/"0"이 사라진다
 * (Apps Script 코드 자체에는 Number()/parseInt() 같은 변환이 없다 -
 * 문제는 Sheets 쪽의 자동 서식 인식이다, 2026-08-24 확인). 이 저장소의
 * Supabase 값(phone_normalized 등)은 이 함수가 전혀 건드리지 않는다 -
 * 오직 이 Sheet 행에 쓸 표시 문자열만 변환한다.
 */
function buildRowFromHeaderMap_(sheet, headerMap, body, isUpdate, existingRow) {
  var lastColumn = sheet.getLastColumn();
  var row = new Array(lastColumn);

  for (var i = 0; i < row.length; i++) {
    row[i] = "";
  }

  for (var header in headerMap) {
    if (!headerMap.hasOwnProperty(header)) {
      continue;
    }

    if (header === "타임스탬프" || header === "secret") {
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(body, header)) {
      var value = body[header];
      row[headerMap[header] - 1] = value === null || value === undefined ? "" : value;
    }
  }

  var phoneHeaders = ["간병인 연락처", "환자 연락처", "설계사 연락처"];
  for (var p = 0; p < phoneHeaders.length; p++) {
    var phoneCol = headerMap[phoneHeaders[p]];
    if (phoneCol) {
      row[phoneCol - 1] = formatPhoneForSheet_(row[phoneCol - 1]);
    }
  }

  if (!isUpdate && headerMap["타임스탬프"]) {
    row[headerMap["타임스탬프"] - 1] = new Date();
  }

  if (headerMap["처리상태"]) {
    if (!isUpdate) {
      row[headerMap["처리상태"] - 1] = "접수";
    } else if (existingRow) {
      row[headerMap["처리상태"] - 1] = sheet
        .getRange(existingRow, headerMap["처리상태"])
        .getValue();
    }
  }

  return row;
}

/**
 * 전화번호를 기존 가족간병관리 Sheet 표시 형식("010-1234-5678")으로
 * 변환한다. Supabase에 저장된 실제 값(E.164 등)은 이 함수 밖에서 전혀
 * 건드리지 않는다 - 이 함수는 Sheet 셀에 쓸 문자열만 만들어 반환한다.
 *
 * 처리 예:
 *   "01012345678"   -> "010-1234-5678"
 *   "010-1234-5678" -> "010-1234-5678" (이미 하이픈 포함, 그대로)
 *   "+821012345678" -> "010-1234-5678"
 *   "821012345678"  -> "010-1234-5678"
 *   "" / null       -> ""
 *
 * 국내 휴대폰 번호(010/011/016/017/018/019 + 7~8자리) 패턴에 맞는
 * 경우에만 하이픈 형식으로 다시 조립한다. 그 외 자릿수/형식(유선번호,
 * 잘못 입력된 값 등)은 임의로 추측해 변형하지 않고 원본 문자열을 그대로
 * 반환한다 - 다만 하이픈이 전혀 없는 숫자만의 문자열이면 여전히 Sheets가
 * 숫자로 자동 인식할 수 있다는 한계가 있다(휴대폰 번호가 아닌 값은 이번
 * 변경 범위 밖).
 */
function formatPhoneForSheet_(value) {
  if (value === null || value === undefined) {
    return "";
  }

  var original = String(value).trim();

  if (original === "") {
    return "";
  }

  var digits = original.replace(/[^0-9]/g, "");

  // "+82"/"82" 국가번호 접두사를 국내 형식(0으로 시작)으로 되돌린다.
  // 정확히 12자리("82" + 10자리 로컬 번호)일 때만 적용해 다른 숫자를
  // 잘못 건드리지 않는다.
  if (digits.length === 12 && digits.indexOf("82") === 0) {
    digits = "0" + digits.slice(2);
  }

  if (/^01[016789]\d{7,8}$/.test(digits)) {
    if (digits.length === 11) {
      return digits.slice(0, 3) + "-" + digits.slice(3, 7) + "-" + digits.slice(7);
    }
    if (digits.length === 10) {
      return digits.slice(0, 3) + "-" + digits.slice(3, 6) + "-" + digits.slice(6);
    }
  }

  return original;
}

// ============================================================================
// 공통 유틸
// ============================================================================

function getScriptProperty_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}
