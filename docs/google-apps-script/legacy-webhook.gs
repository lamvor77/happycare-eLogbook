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

  var existingRowNumber = findRowByRegistrationNo_(sheet, headerMap, registrationNo);
  var upsertOnDuplicate = getScriptProperty_("HAPPYCARE_UPSERT_ON_DUPLICATE") === "true";

  if (existingRowNumber) {
    if (!upsertOnDuplicate) {
      // 기본 동작: 같은 등록번호면 새 행을 추가하지 않는다(중복 방지).
      // 재전송(관리자 [다시 전송])이 몇 번 와도 안전하다.
      return jsonResponse_({ ok: true, registration_no: registrationNo, action: "duplicate" });
    }

    var rowValues = buildRowFromHeaderMap_(sheet, headerMap, body, /* isUpdate */ true);
    sheet.getRange(existingRowNumber, 1, 1, rowValues.length).setValues([rowValues]);
    return jsonResponse_({ ok: true, registration_no: registrationNo, action: "updated" });
  }

  var newRow = buildRowFromHeaderMap_(sheet, headerMap, body, /* isUpdate */ false);
  sheet.appendRow(newRow);

  return jsonResponse_({ ok: true, registration_no: registrationNo, action: "inserted" });
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
 * 값만 채운 배열을 만든다. body에 없는 헤더(처리상태, 검토메모, 종료일,
 * 비고, 접수알림_보호자, 접수알림_설계사, 등록완료알림_보호자,
 * 등록완료알림_설계사, 오류메모, "5. 확인 및 동의" 등 이번 단계에서
 * 전자일지가 보내지 않는 후속관리 컬럼, 작업 H)는 빈 문자열로 남겨 기존
 * Sheet의 기본 처리(수식 등)에 맡긴다 — 값을 임의로 채우지 않는다.
 * "타임스탬프"는 body에 없을 것이 확실하므로(전자일지가 보내지 않음)
 * 신규 삽입 시에만 이 함수가 현재 시각으로 채운다.
 */
function buildRowFromHeaderMap_(sheet, headerMap, body, isUpdate) {
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

  if (!isUpdate && headerMap["타임스탬프"]) {
    row[headerMap["타임스탬프"] - 1] = new Date();
  }

  return row;
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
