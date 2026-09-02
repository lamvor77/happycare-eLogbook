import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { decryptResidentNumber } from "@/lib/caregiver-resident-number";
import { formatResidentNumberWithHyphen } from "@/lib/registration-validation";
import {
  LEGACY_CONSENT_RESPONSE,
  REQUEST_TIMEOUT_MS,
  toSheetBirthDate,
  toSheetGender,
  type LegacySyncErrorCode,
  type LegacySyncResult,
} from "@/lib/legacy-sync";

/**
 * 가족간병인 추가 참여(family_join) → 기존 가족간병관리 시스템 전송.
 *
 * 기존 lib/legacy-sync.ts의 syncCaseToLegacySystem(caseId)은 "사례 하나 =
 * 등록 하나"를 전제로 만들어졌다. 그 의미를 억지로 비틀지 않고, 등록 건
 * (caregiver_registrations) 기준으로 동작하는 함수를 따로 둔다 — 최초 등록
 * 경로는 지금까지처럼 syncCaseToLegacySystem을 그대로 쓴다.
 *
 * 두 함수가 공유하는 것(중복 구현하지 않는다):
 *   - Sheet 헤더 문자열 key 규약
 *   - 동의 응답 고정 문자열(LEGACY_CONSENT_RESPONSE)
 *   - 성별 표시값 변환(toSheetGender)
 *   - 요청 타임아웃(REQUEST_TIMEOUT_MS, 30초)
 *   - 안전한 오류 코드 체계(LegacySyncErrorCode)
 *
 * 다른 것:
 *   - 상태를 cases가 아니라 caregiver_registrations.legacy_sync_*에 쓴다.
 *   - 등록번호를 cases.registration_no가 아니라
 *     caregiver_registrations.registration_no에서 가져온다.
 *   - 간병인 정보(성명/주민등록번호/연락처/관계/동의)를 "그 등록 건의
 *     간병인"에게서 가져온다 — 최초 간병인의 값을 절대 쓰지 않는다.
 *   - payload에 registration_type: 'family_join'을 넣는다(아래 참고).
 *
 * 접수 알림(운영 정책, 2026-08-28 변경):
 *   family_join 신규 행도 최초 등록과 똑같이 processReceptionRow_를 타서
 *   보호자/설계사/직원 접수 알림이 발송된다. 담당직원이 신규 가족간병인
 *   등록 내용을 확인하고 처리상태를 "등록완료"로 바꿔야 하기 때문이다.
 *   이전에 두었던 family_join 알림 억제 분기는 폐기했다 — Apps Script는
 *   registration_type을 알림 분기에 쓰지 않는다.
 *
 *   registration_type은 등록 건 종류를 수신 측에 알려주는 식별값으로만
 *   남긴다. Sheet 헤더에 없는 이름이라 buildRowFromHeaderMap_이 무시하므로
 *   시트에 새 컬럼이 생기지 않는다.
 *
 * 개인정보 처리 원칙은 lib/legacy-sync.ts와 동일하다 — 주민등록번호는 이
 * 함수 안에서만 복호화하고, 원문/암호문/요청 body/응답 body를 절대
 * console에 남기지 않는다. 실패 시에도 안전한 코드만 기록한다.
 */

interface LegacyRegistrationPayload {
  secret: string;
  /**
   * 등록 건 종류. Sheet 헤더에 없는 이름이라 시트에 기록되지 않는다.
   * 알림 발송 여부를 가르는 데는 쓰지 않는다(2026-08-28 정책 변경).
   */
  registration_type: "family_join";
  등록번호: string;
  현재상태: string | null;
  "간병인 성명": string | null;
  "간병인 주민등록번호": string | null;
  "간병인 연락처": string | null;
  /**
   * 운영 Sheet에 "환자와의 관계" 헤더를 추가하면 그 열에 기록된다.
   * 헤더가 아직 없으면 buildRowFromHeaderMap_이 이 key를 읽지 않으므로
   * 아무 일도 일어나지 않는다(오류가 아니라 무시) — 그래서 Sheet 헤더
   * 추가와 이 코드 배포의 선후 관계가 자유롭다.
   */
  "환자와의 관계": string | null;
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

async function updateRegistrationSyncStatus(
  registrationId: string,
  status: "synced" | "failed",
  errorCode: LegacySyncErrorCode | null
) {
  const admin = createSupabaseAdminClient();

  const { error } = await admin
    .from("caregiver_registrations")
    .update({
      legacy_sync_status: status,
      legacy_synced_at: status === "synced" ? new Date().toISOString() : null,
      legacy_sync_error: errorCode,
    })
    .eq("registration_id", registrationId);

  if (error) {
    console.error("caregiver_registrations 동기화 상태 갱신 실패:", error.message);
  }
}

/**
 * 등록 건 하나를 기존 시스템으로 전송하고, 결과에 따라
 * caregiver_registrations.legacy_sync_* 를 갱신한다.
 *
 * 클라이언트가 보낸 값은 전혀 신뢰하지 않고 registration_id로 DB에서 모두
 * 다시 조회한다(lib/legacy-sync.ts와 같은 재검증 원칙).
 */
export async function syncCaregiverRegistrationToLegacySystem(
  registrationId: string
): Promise<LegacySyncResult> {
  const webhookUrl = process.env.LEGACY_FAMILYCARE_WEBHOOK_URL;
  const secret = process.env.LEGACY_FAMILYCARE_WEBHOOK_SECRET;

  if (!webhookUrl || !secret) {
    await updateRegistrationSyncStatus(registrationId, "failed", "not_configured");
    return { ok: false, errorCode: "not_configured" };
  }

  const admin = createSupabaseAdminClient();

  // 등록 건 + 그 등록 건의 간병인 + 사례 정보를 한 번에 가져온다.
  const { data: registration } = await admin
    .from("caregiver_registrations")
    .select(
      `
      registration_id, registration_no, relationship, case_id, caregiver_id, consent_id,
      caregivers ( caregiver_name, phone, resident_number_ciphertext, resident_number_iv, resident_number_auth_tag, resident_number_key_version ),
      cases ( admission_status, patient_name, patient_birth_date, patient_phone, patient_gender, diagnosis_name, room_no, insurance_company, insurance_company_other, accident_type, planner_name, planner_phone, care_start_date, hospitals ( hospital_name ) )
      `
    )
    .eq("registration_id", registrationId)
    .maybeSingle();

  if (!registration) {
    await updateRegistrationSyncStatus(registrationId, "failed", "case_not_found");
    return { ok: false, errorCode: "case_not_found" };
  }

  // supabase-js가 단일 관계를 배열로 추론할 수 있어 캐스팅한다(기존
  // lib/legacy-sync.ts의 hospitals 임베드와 같은 처리).
  const caseRow = registration.cases as unknown as {
    admission_status: string | null;
    patient_name: string;
    patient_birth_date: string | null;
    patient_phone: string | null;
    patient_gender: string | null;
    diagnosis_name: string | null;
    room_no: string | null;
    insurance_company: string | null;
    insurance_company_other: string | null;
    accident_type: string | null;
    planner_name: string | null;
    planner_phone: string | null;
    care_start_date: string | null;
    hospitals: { hospital_name: string | null } | null;
  } | null;

  if (!caseRow) {
    await updateRegistrationSyncStatus(registrationId, "failed", "case_not_found");
    return { ok: false, errorCode: "case_not_found" };
  }

  const caregiver = registration.caregivers as unknown as {
    caregiver_name: string | null;
    phone: string | null;
    resident_number_ciphertext: string | null;
    resident_number_iv: string | null;
    resident_number_auth_tag: string | null;
    resident_number_key_version: number | null;
  } | null;

  if (!caregiver) {
    await updateRegistrationSyncStatus(registrationId, "failed", "no_current_caregiver");
    return { ok: false, errorCode: "no_current_caregiver" };
  }

  const hospital = caseRow.hospitals as unknown as { hospital_name: string | null } | null;

  let caregiverResidentNumber: string | null = null;

  if (
    caregiver.resident_number_ciphertext &&
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
        "등록 건 전송: 간병인 주민등록번호 복호화 실패(key_version 확인 필요)"
      );
      await updateRegistrationSyncStatus(registrationId, "failed", "decrypt_failed");
      return { ok: false, errorCode: "decrypt_failed" };
    }
  }

  // "5. 확인 및 동의"는 이 등록 건이 가리키는 동의 기록만 기준으로 채운다 —
  // 최초 간병인의 동의를 쓰지 않는다. consent_id가 비어 있으면(동의 행이
  // 여러 개라 어느 것이 근거인지 모호했던 경우) 임의로 하나를 골라 채우지
  // 않고 이 칸을 비워 보낸다 — 잘못된 동의 근거를 Sheet에 남기는 것보다
  // 비워 두는 편이 안전하다.
  let allConsentsConfirmed = false;

  if (registration.consent_id) {
    const { data: consent } = await admin
      .from("case_consents")
      .select(
        "integrated_care_ward_confirmed, direct_care_confirmed, false_application_confirmed, insurance_not_guaranteed_confirmed, information_accuracy_confirmed, privacy_consent_confirmed"
      )
      .eq("consent_id", registration.consent_id)
      .maybeSingle();

    allConsentsConfirmed = Boolean(
      consent?.integrated_care_ward_confirmed &&
        consent?.direct_care_confirmed &&
        consent?.false_application_confirmed &&
        consent?.insurance_not_guaranteed_confirmed &&
        consent?.information_accuracy_confirmed &&
        consent?.privacy_consent_confirmed
    );
  }

  const otherDetail =
    caseRow.insurance_company === "기타" ? caseRow.insurance_company_other : null;

  const payload: LegacyRegistrationPayload = {
    secret,
    registration_type: "family_join",
    // --- 이 등록 건(추가 간병인)에서 가져오는 값 ---
    등록번호: registration.registration_no,
    "간병인 성명": caregiver.caregiver_name || null,
    "간병인 주민등록번호": caregiverResidentNumber
      ? formatResidentNumberWithHyphen(caregiverResidentNumber)
      : caregiverResidentNumber,
    "간병인 연락처": caregiver.phone || null,
    "환자와의 관계": registration.relationship,
    "5. 확인 및 동의": allConsentsConfirmed ? LEGACY_CONSENT_RESPONSE : null,
    // --- 기존 사례에서 가져오는 값 ---
    현재상태: caseRow.admission_status,
    "환자 성명": caseRow.patient_name,
    "환자 생년월일": toSheetBirthDate(caseRow.patient_birth_date),
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
  };
  // 이 지점 이후로 caregiverResidentNumber(원문)를 다시 참조하지 않는다.

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
      await updateRegistrationSyncStatus(registrationId, "failed", errorCode);
      return { ok: false, errorCode };
    }

    // Apps Script Web App은 스크립트가 죽지 않는 한 항상 200을 반환하므로
    // 성공 여부는 body의 ok로 판단한다(body 전체는 로그로 남기지 않는다).
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
      await updateRegistrationSyncStatus(registrationId, "failed", "invalid_response");
      return { ok: false, errorCode: "invalid_response" };
    }

    await updateRegistrationSyncStatus(registrationId, "synced", null);
    return { ok: true };
  } catch (error) {
    const errorCode: LegacySyncErrorCode =
      error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
    console.error("등록 건 전송 실패:", errorCode);
    await updateRegistrationSyncStatus(registrationId, "failed", errorCode);
    return { ok: false, errorCode };
  } finally {
    clearTimeout(timeout);
  }
}
