import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { decryptResidentNumber } from "@/lib/caregiver-resident-number";
import { formatResidentNumberWithHyphen } from "@/lib/registration-validation";

/**
 * 전자일지(QR 최초 등록) → 기존 가족간병관리 시스템 자동 전송.
 *
 * 이 저장소에는 기존 가족간병관리 시스템으로 데이터를 보낼 실제 통로가
 * 없다(app/api/google-form-sync는 반대 방향 — Google Form → 이 앱). 그래서
 * 이 파일은 신규로 설계한 아웃바운드 웹훅 계약의 "보내는 쪽"만 구현한다.
 * 받는 쪽(기존 Google Sheet/Apps Script 쪽에 이 데이터를 수신할 엔드포인트)은
 * 운영팀이 이 저장소 밖에서 별도로 구축/배포해야 한다 — 계약 상세는
 * docs/legacy-sync-integration.md, 컬럼 매핑 근거는
 * docs/legacy-family-care-field-map.md 참고.
 *
 * payload의 key는 실제 기존 가족간병관리 Google Sheet 헤더 문자열을 그대로
 * 쓴다(2026-08-23 확인, docs/legacy-family-care-field-map.md 3절) — 임의로
 * 영문 키나 축약된 이름을 만들지 않는다. Sheet의 후속 업무 전용 컬럼
 * (처리상태/검토메모/종료일/비고/알림 4종/오류메모/타임스탬프)은 최초
 * 전송 시 아예 보내지 않는다 — 기존 Apps Script의 기본 처리에 맡긴다
 * (docs/legacy-family-care-field-map.md 참고).
 *
 * 환경변수(.env.example):
 *   LEGACY_FAMILYCARE_WEBHOOK_URL — 기존 시스템이 수신할 HTTPS 엔드포인트
 *   LEGACY_FAMILYCARE_WEBHOOK_SECRET — 공유 시크릿
 *
 * 시크릿 전달 방식(중요): Google Apps Script Web App의 doPost(e)는 커스텀
 * 요청 헤더를 읽을 수 없다(Apps Script의 알려진 제약 — e 객체에 parameter/
 * postData/queryString은 있어도 headers는 없다). 그래서 시크릿은
 * `x-legacy-sync-secret` 헤더로도 함께 보내지만(다른 종류의 수신 서버로
 * 교체될 가능성에 대비한 하위 호환용, 무해함), **실제 인증 판단은 JSON
 * body의 `secret` 필드로 한다** — docs/google-apps-script/legacy-webhook.gs
 * 와 docs/legacy-sync-integration.md 참고.
 *
 * 개인정보 처리 원칙(작업 29):
 *   - 간병인 주민등록번호는 이 함수 안에서만 복호화하고, 요청 body를 만든
 *     직후 더 이상 원문 변수를 참조하지 않는다.
 *   - 원문/암호문/요청 body/응답 body를 절대 console에 출력하지 않는다 —
 *     실패 시에도 아래 LegacySyncErrorCode(안전한 코드)만 로그/DB에 남긴다.
 *   - case_history에는 이 함수가 아무것도 기록하지 않는다(호출부가 이미
 *     REGISTER 이력을 별도로 남긴다 — 여기서 중복/민감정보 기록을 만들지
 *     않는다).
 *   - cases.legacy_sync_error에도 원문 에러 메시지가 아니라 아래 안전한
 *     코드 문자열만 저장한다.
 */

export type LegacySyncErrorCode =
  | "not_configured"
  | "case_not_found"
  | "no_current_caregiver"
  | "decrypt_failed"
  | "timeout"
  | "network_error"
  | "http_4xx"
  | "http_5xx"
  | "invalid_response";

export interface LegacySyncResult {
  ok: boolean;
  errorCode?: LegacySyncErrorCode;
}

/**
 * Apps Script 응답 대기 한도.
 *
 * 10초에서 30초로 올렸다(2026-08-27). 실제 운영 등록 1건(E260827-002)에서
 * Google Sheet 행 생성과 알림톡 발송이 모두 정상 완료됐는데도 우리 쪽만
 * 10초에 기다리기를 포기해 legacy_sync_status를 'failed'(timeout)로
 * 기록하는 false negative가 확인됐다 — Apps Script 응답이 이전 실측에서도
 * 3.5~8.5초로 편차가 커서 10초는 여유가 부족했다.
 *
 * 이 대기 시간은 더 이상 사용자를 붙잡지 않는다 — 전송은 등록 응답을 보낸
 * 뒤 after() 콜백에서 실행되므로(app/api/cases/register/route.ts) 여기서
 * 오래 기다려도 등록 응답 시간에는 영향이 없다.
 *
 * 30초는 관리자 stale-pending 기준(5분, lib/legacy-sync-pending.ts)보다
 * 충분히 짧아, "정상 처리 중인 pending"이 그 기준을 넘길 일이 없다.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * 환자 성별 저장값("남"/"여")을 Sheet가 쓰는 표시값("남자"/"여자")으로
 * 변환한다 — DB 저장값 자체는 바꾸지 않는다(작업 10, 기존 데이터 유지).
 */
export function toSheetGender(value: string | null): string | null {
  if (value === "남") return "남자";
  if (value === "여") return "여자";
  return value;
}

/**
 * "5. 확인 및 동의" 컬럼에 넣을 값 — 기존 Google Form으로 실제 정상
 * 등록된 행에서 확인한 Sheet 저장 문자열 그대로다(2026-08-25, 사용자
 * 확인). 임의로 만든 값이 아니다 — 쉼표/쉼표 뒤 공백/마침표/문장 순서
 * 전부 실제 값과 동일하게 유지한다. 전자일지 쪽에서 새로 만들지 않고
 * 이 상수 하나로만 참조한다 — 등록 건 기준 전송(lib/
 * legacy-sync-registration.ts)도 같은 값을 써야 하므로 export한다.
 */
export const LEGACY_CONSENT_RESPONSE =
  "간호통합병동은 가족간병 신청이 불가함을 확인했습니다., 등록한 간병인이 직접 간병해야 함을 확인했습니다., 허위 신청 시 본사가 책임지지 않음을 확인했습니다., 가족간병인 등록은 보험금 지급을 보장하지 않음을 확인했습니다., 본인은 입력한 내용이 사실과 다를 경우 보험금 지급이 제한될 수 있음을 확인합니다., 개인정보 수집 및 이용에 동의합니다.";

/**
 * 기존 Sheet의 정확한 헤더 문자열을 key로 쓴다(docs/
 * legacy-family-care-field-map.md 3절). "5. 확인 및 동의"는 2026-08-25
 * 실제 Google Form 응답 문자열이 확인되어 활성화됐다(LEGACY_CONSENT_RESPONSE
 * 참고) — case_consents 6개 항목이 모두 true일 때만 이 고정 문자열을
 * 채운다(아래 syncCaseToLegacySystem에서 다시 조회해 확인). 전자일지
 * 등록은 서버가 이미 6개 동의를 모두 강제하므로(app/api/cases/register/
 * route.ts의 isConsentComplete 검증) 정상 등록 건은 항상 이 값이 채워지고,
 * 이 값을 못 채우는 경우는 정상적으로 발생하지 않는다 — 그래도 이 파일
 * 자체의 "클라이언트/이전 단계를 신뢰하지 않고 case_id로 다시 조회한다"는
 * 기존 원칙을 그대로 지켜 여기서도 다시 확인한다. case_consents 저장
 * 구조 자체는 변경하지 않는다.
 */
interface LegacySheetPayload {
  /** Apps Script doPost(e)가 헤더를 읽을 수 없어 body로 함께 보내는 시크릿. */
  secret: string;
  등록번호: string;
  현재상태: string | null;
  "간병인 성명": string | null;
  "간병인 주민등록번호": string | null;
  "간병인 연락처": string | null;
  "환자 성명": string;
  "환자 생년월일": string | null;
  "환자 연락처": string | null;
  "환자 진단명": string | null;
  병원명: string | null;
  입원호실: string | null;
  보험사: string | null;
  담당설계사: string | null;
  "설계사 연락처": string | null;
  "간병개시 예정일": string | null;
  "환자 성별": string | null;
  사고유형: string | null;
  "기타인 경우 입력해주세요": string | null;
  "5. 확인 및 동의": string | null;
}

async function updateSyncStatus(
  caseId: string,
  status: "synced" | "failed",
  errorCode: LegacySyncErrorCode | null
) {
  const admin = createSupabaseAdminClient();

  const { error } = await admin
    .from("cases")
    .update({
      legacy_sync_status: status,
      legacy_synced_at: status === "synced" ? new Date().toISOString() : null,
      legacy_sync_error: errorCode,
    })
    .eq("case_id", caseId);

  if (error) {
    console.error("legacy_sync_status 갱신 실패:", error.message);
  }
}

/**
 * case_id 하나에 대해 기존 시스템 전송을 시도하고, 결과에 따라
 * cases.legacy_sync_status/legacy_synced_at/legacy_sync_error를 갱신한다.
 * 클라이언트가 보낸 값은 전혀 신뢰하지 않고, case_id로 DB에서 모든 값을
 * 다시 조회한다(다른 서버 라우트들과 동일한 재검증 원칙).
 */
export async function syncCaseToLegacySystem(caseId: string): Promise<LegacySyncResult> {
  const webhookUrl = process.env.LEGACY_FAMILYCARE_WEBHOOK_URL;
  const secret = process.env.LEGACY_FAMILYCARE_WEBHOOK_SECRET;

  if (!webhookUrl || !secret) {
    await updateSyncStatus(caseId, "failed", "not_configured");
    return { ok: false, errorCode: "not_configured" };
  }

  const admin = createSupabaseAdminClient();

  const { data: caseRow } = await admin
    .from("cases")
    .select(
      "case_id, registration_no, admission_status, patient_name, patient_birth_date, patient_phone, patient_gender, diagnosis_name, room_no, insurance_company, insurance_company_other, accident_type, accident_type_etc, planner_name, planner_phone, care_start_date, hospitals ( hospital_name )"
    )
    .eq("case_id", caseId)
    .maybeSingle();

  if (!caseRow) {
    await updateSyncStatus(caseId, "failed", "case_not_found");
    return { ok: false, errorCode: "case_not_found" };
  }

  // hospitals 임베드는 관계상 단일 행이지만 supabase-js가 배열로 추론할 수
  // 있어(알려진 타입 추론 이슈, docs/data-model.md 참고) 캐스팅한다.
  const hospital = caseRow.hospitals as unknown as { hospital_name: string | null } | null;

  const { data: link } = await admin
    .from("case_caregivers")
    .select(
      "relationship, caregivers ( caregiver_name, phone, resident_number_ciphertext, resident_number_iv, resident_number_auth_tag, resident_number_key_version )"
    )
    .eq("case_id", caseId)
    .eq("is_current_caregiver", true)
    .eq("status", "활성")
    .maybeSingle();

  if (!link) {
    await updateSyncStatus(caseId, "failed", "no_current_caregiver");
    return { ok: false, errorCode: "no_current_caregiver" };
  }

  const caregiver = link.caregivers as unknown as {
    caregiver_name: string | null;
    phone: string | null;
    resident_number_ciphertext: string | null;
    resident_number_iv: string | null;
    resident_number_auth_tag: string | null;
    resident_number_key_version: number | null;
  } | null;

  let caregiverResidentNumber: string | null = null;

  if (
    caregiver?.resident_number_ciphertext &&
    caregiver.resident_number_iv &&
    caregiver.resident_number_auth_tag &&
    caregiver.resident_number_key_version
  ) {
    try {
      caregiverResidentNumber = decryptResidentNumber({
        ciphertext: caregiver.resident_number_ciphertext,
        iv: caregiver.resident_number_iv,
        authTag: caregiver.resident_number_auth_tag,
        keyVersion: caregiver.resident_number_key_version,
      });
    } catch {
      console.error(
        "legacy sync 간병인 주민등록번호 복호화 실패(key_version 확인 필요)"
      );
      await updateSyncStatus(caseId, "failed", "decrypt_failed");
      return { ok: false, errorCode: "decrypt_failed" };
    }
  }

  // 보험사가 "기타"면 Sheet의 "기타인 경우 입력해주세요" 컬럼에 상세
  // 텍스트를 보낸다(작업 19) — accident_type_etc(사고유형 기타 상세)와는
  // 별개 값이지만 Sheet 헤더가 하나뿐이라 같은 컬럼을 공유한다(작업 3의
  // 실제 헤더 목록 기준, 사고유형은 "기타" 선택지가 없다).
  const otherDetail =
    caseRow.insurance_company === "기타" ? caseRow.insurance_company_other : null;

  // "5. 확인 및 동의"는 case_consents 6개 항목이 모두 true일 때만 채운다.
  // 등록 시점에 서버가 이미 6개 모두를 강제하므로(app/api/cases/register/
  // route.ts) 정상 등록 건은 항상 true지만, 클라이언트/이전 단계를
  // 신뢰하지 않는 이 파일의 기존 원칙대로 case_id로 다시 조회해 확인한다.
  const { data: consent } = await admin
    .from("case_consents")
    .select(
      "integrated_care_ward_confirmed, direct_care_confirmed, false_application_confirmed, insurance_not_guaranteed_confirmed, information_accuracy_confirmed, privacy_consent_confirmed"
    )
    .eq("case_id", caseId)
    .maybeSingle();

  const allConsentsConfirmed = Boolean(
    consent?.integrated_care_ward_confirmed &&
      consent?.direct_care_confirmed &&
      consent?.false_application_confirmed &&
      consent?.insurance_not_guaranteed_confirmed &&
      consent?.information_accuracy_confirmed &&
      consent?.privacy_consent_confirmed
  );

  const payload: LegacySheetPayload = {
    secret,
    등록번호: caseRow.registration_no,
    현재상태: caseRow.admission_status,
    "간병인 성명": caregiver?.caregiver_name || null,
    // 복호화 직후 13자리 순수 숫자를 기존 가족간병관리 Sheet 표시 형식
    // ("900101-1234567")으로 변환한다 — 화면 입력 검증에도 이미 쓰는
    // lib/registration-validation.ts의 formatResidentNumberWithHyphen을
    // 그대로 재사용한다(새 formatter 없음). 이 값을 담는 변수는 여기
    // payload 구성 시점 이후로 더 참조하지 않는다(기존 원칙 그대로).
    "간병인 주민등록번호": caregiverResidentNumber
      ? formatResidentNumberWithHyphen(caregiverResidentNumber)
      : caregiverResidentNumber,
    "간병인 연락처": caregiver?.phone || null,
    "환자 성명": caseRow.patient_name,
    "환자 생년월일": caseRow.patient_birth_date,
    "환자 연락처": caseRow.patient_phone,
    "환자 진단명": caseRow.diagnosis_name,
    병원명: hospital?.hospital_name || null,
    입원호실: caseRow.room_no,
    보험사: caseRow.insurance_company,
    담당설계사: caseRow.planner_name,
    "설계사 연락처": caseRow.planner_phone,
    "간병개시 예정일": caseRow.care_start_date,
    "환자 성별": toSheetGender(caseRow.patient_gender),
    사고유형: caseRow.accident_type,
    "기타인 경우 입력해주세요": otherDetail,
    "5. 확인 및 동의": allConsentsConfirmed ? LEGACY_CONSENT_RESPONSE : null,
  };
  // 이 지점 이후로는 caregiverResidentNumber(원문)를 fetch 요청 body 구성
  // 외의 용도로 참조하지 않는다 — 로그/응답/DB 어디에도 다시 담지 않는다.

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-legacy-sync-secret": secret,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorCode: LegacySyncErrorCode =
        response.status >= 500 ? "http_5xx" : "http_4xx";
      await updateSyncStatus(caseId, "failed", errorCode);
      return { ok: false, errorCode };
    }

    // Apps Script Web App은 스크립트 자체가 예외로 죽지 않는 한 항상 HTTP
    // 200을 반환한다 — 성공/실패 여부는 반드시 body의 ok 필드로 판단해야
    // 하고, response.ok(2xx)만으로는 실패를 놓칠 수 있다(작업 D/E). body
    // 전체는 로그로 남기지 않는다 — ok만 확인하고 버린다.
    let parsedOk = false;
    try {
      const responseBody = await response.json();
      parsedOk =
        responseBody != null &&
        typeof responseBody === "object" &&
        (responseBody as { ok?: unknown }).ok === true;
    } catch {
      parsedOk = false;
    }

    if (!parsedOk) {
      await updateSyncStatus(caseId, "failed", "invalid_response");
      return { ok: false, errorCode: "invalid_response" };
    }

    // action(inserted/duplicate/updated) 값과 무관하게 ok:true면 성공으로
    // 처리한다 — 같은 등록번호로 재전송된 duplicate도 정상 동작이다(작업 D).
    await updateSyncStatus(caseId, "synced", null);
    return { ok: true };
  } catch (error) {
    const errorCode: LegacySyncErrorCode =
      error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
    console.error("legacy sync 전송 실패:", errorCode);
    await updateSyncStatus(caseId, "failed", errorCode);
    return { ok: false, errorCode };
  } finally {
    clearTimeout(timeout);
  }
}
