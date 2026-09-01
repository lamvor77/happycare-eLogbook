import { NextResponse, after } from "next/server";
import { supabase } from "@/lib/supabase";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getCaregiverSession } from "@/lib/caregiver-auth";
import { issueCaregiverSession } from "@/lib/caregiver-session";
import { consumeVerifiedOtp } from "@/lib/otp";
import { toE164 } from "@/lib/phone";
import {
  normalizeResidentNumber,
  encryptResidentNumber,
  maskResidentNumber,
} from "@/lib/caregiver-resident-number";
import {
  normalizePatientBirthDateYyyymmdd,
  isConsentComplete,
} from "@/lib/registration-validation";
import {
  ACCIDENT_TYPE_OPTIONS,
  ADMISSION_STATUS_OPTIONS,
  type ConsentKey,
} from "@/lib/registration-options";
import { isSameOriginRequest, sameOriginErrorResponse } from "@/lib/request-guard";
import { syncCaseToLegacySystem } from "@/lib/legacy-sync";

interface RegisterRequestBody {
  hospital_token?: string;
  hospital_code?: string;
  caregiver_name?: string;
  caregiver_phone?: string;
  // 간병인 주민등록번호 전체 13자리(하이픈 유무 무관). 이 값은 암호화
  // 직후 더 이상 참조하지 않는다 — 응답/로그/case_history 어디에도 넣지
  // 않는다.
  resident_number?: string;
  admission_status?: string;
  patient_name?: string;
  patient_birth_yyyymmdd?: string;
  patient_phone?: string;
  patient_gender?: string;
  relationship?: string;
  diagnosis_name?: string;
  room_no?: string;
  insurance_company?: string;
  insurance_company_other?: string;
  accident_type?: string;
  accident_type_etc?: string;
  planner_name?: string;
  planner_phone?: string;
  care_start_date?: string;
  care_end_date?: string;
  memo?: string;
  consent_version?: string;
  consents?: Partial<Record<ConsentKey, boolean>>;
  privacy_agreed?: boolean;
}

function mapRpcError(message: string): { status: number; error: string } {
  if (message.includes("privacy_not_agreed")) {
    return { status: 400, error: "개인정보 수집 및 이용에 동의해주세요." };
  }

  if (message.includes("consent_incomplete") || message.includes("invalid_consent_version")) {
    return { status: 400, error: "동의 항목을 모두 확인해주세요." };
  }

  if (message.includes("invalid_hospital")) {
    return { status: 400, error: "병원 정보를 찾을 수 없습니다." };
  }

  if (message.includes("invalid_caregiver_phone")) {
    return { status: 400, error: "휴대폰번호를 확인해주세요." };
  }

  if (message.includes("invalid_resident_number")) {
    return { status: 400, error: "간병인 주민등록번호를 확인해주세요." };
  }

  if (message.includes("invalid_admission_status")) {
    return { status: 400, error: "현재상태를 확인해주세요." };
  }

  if (message.includes("invalid_insurance_company_other")) {
    return { status: 400, error: "보험사 정보를 확인해주세요." };
  }

  return { status: 500, error: "등록 처리에 실패했습니다." };
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return sameOriginErrorResponse();
  }

  let body: RegisterRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  // 요청 본문 전체를 로그로 남기지 않는다(개인정보/주민등록번호 포함
  // 가능성). 아래에서 개별 필드만 필요한 만큼 꺼내 쓴다.

  if (!body.patient_name || !body.relationship) {
    return NextResponse.json({ error: "필수 정보를 입력해주세요." }, { status: 400 });
  }

  if (!body.hospital_token && !body.hospital_code) {
    return NextResponse.json({ error: "병원 정보를 찾을 수 없습니다." }, { status: 400 });
  }

  if (!isConsentComplete(body.consents || {})) {
    return NextResponse.json({ error: "동의 항목을 모두 확인해주세요." }, { status: 400 });
  }

  if (!body.consent_version) {
    return NextResponse.json({ error: "동의 정보를 확인해주세요." }, { status: 400 });
  }

  // admission_status(현재상태)는 이제 register_case_v3의
  // p_admission_status 파라미터로 전달되어 사례 생성과 같은 트랜잭션 안에서
  // cases.admission_status에 저장된다(20260823090000_
  // legacy_sync_field_map.sql). 여기서는 값의 형식만 먼저 확인한다.
  if (
    body.admission_status &&
    !ADMISSION_STATUS_OPTIONS.some((option) => option.value === body.admission_status)
  ) {
    return NextResponse.json({ error: "현재상태를 확인해주세요." }, { status: 400 });
  }

  // 사고유형은 기존 Google Form의 실제 값(질병/상해/교통사고) 외에는
  // 거부한다(작업 11).
  if (
    body.accident_type &&
    !ACCIDENT_TYPE_OPTIONS.some((option) => option.value === body.accident_type)
  ) {
    return NextResponse.json({ error: "사고유형을 확인해주세요." }, { status: 400 });
  }

  // 보험사: 정상적으로는 GET /api/registration-options가 내려준 목록 중
  // 하나 또는 "기타"이지만, 그 조회 자체가 실패했을 때는 화면이 직접입력
  // fallback으로 전환된다(작업 3) — 그 경우 임의 문자열이 올 수 있으므로
  // 서버는 목록 검증 대신 형식만 검증한다(과도한 길이 방지).
  const INSURANCE_COMPANY_MAX_LENGTH = 100;

  if (body.insurance_company && body.insurance_company.trim().length > INSURANCE_COMPANY_MAX_LENGTH) {
    return NextResponse.json({ error: "보험사명을 다시 확인해주세요." }, { status: 400 });
  }

  // insurance_company_other는 보험사가 정확히 "기타"일 때만 의미가 있다 —
  // 그 외 조합이면 서버가 무시하고 저장하지 않는다(RPC 쪽에서도 같은
  // 불변조건을 한 번 더 강제한다).
  const insuranceCompanyOther =
    body.insurance_company === "기타" ? body.insurance_company_other || null : null;

  const patientBirthDate = normalizePatientBirthDateYyyymmdd(body.patient_birth_yyyymmdd || "");

  if (!patientBirthDate) {
    return NextResponse.json(
      { error: "환자 생년월일 8자리(YYYYMMDD)를 정확히 입력해주세요." },
      { status: 400 }
    );
  }

  // 이미 유효한 세션이 있으면(재방문 등록) 그 caregiver 신원을 그대로
  // 쓰고, 클라이언트가 보낸 이름/전화번호/주민등록번호는 신뢰하지 않는다.
  // 세션이 없으면 방금 소비되지 않은 OTP 인증이 있어야만 진행할 수 있다.
  const existingSession = await getCaregiverSession();

  let caregiverName: string;
  let caregiverPhoneNormalized: string;
  let hasExistingSession = false;

  let residentNumberMasked: string | null = null;
  let residentNumberCiphertext: string | null = null;
  let residentNumberIv: string | null = null;
  let residentNumberAuthTag: string | null = null;
  let residentNumberKeyVersion: number | null = null;

  if (existingSession) {
    hasExistingSession = true;
    caregiverName = existingSession.caregiver.caregiver_name;
    caregiverPhoneNormalized = existingSession.caregiver.phone_normalized;
    // 기존 세션의 caregiver는 최초 등록 시 이미 암호화된 주민등록번호를
    // 저장했으므로 다시 요구/전달하지 않는다.
  } else {
    if (!body.caregiver_name || !body.caregiver_phone) {
      return NextResponse.json({ error: "필수 정보를 입력해주세요." }, { status: 400 });
    }

    caregiverName = body.caregiver_name;
    caregiverPhoneNormalized = toE164(body.caregiver_phone);

    const otpConsumed = await consumeVerifiedOtp(caregiverPhoneNormalized);

    if (!otpConsumed) {
      return NextResponse.json(
        { error: "휴대폰 인증이 필요합니다. 인증코드를 다시 받아주세요." },
        { status: 401 }
      );
    }

    if (!body.resident_number) {
      return NextResponse.json(
        { error: "간병인 주민등록번호를 입력해주세요." },
        { status: 400 }
      );
    }

    const digits13 = normalizeResidentNumber(body.resident_number);

    if (!digits13) {
      return NextResponse.json(
        { error: "간병인 주민등록번호 13자리를 정확히 입력해주세요." },
        { status: 400 }
      );
    }

    residentNumberMasked = maskResidentNumber(digits13);

    const encrypted = encryptResidentNumber(digits13);
    residentNumberCiphertext = encrypted.ciphertext;
    residentNumberIv = encrypted.iv;
    residentNumberAuthTag = encrypted.authTag;
    residentNumberKeyVersion = encrypted.keyVersion;
    // 이 지점 이후로는 digits13(원문)을 더 이상 참조하지 않는다.
  }

  // hospitals를 직접 조회하지 않고 SECURITY DEFINER 함수를 쓴다(anon에게
  // qr_token 컬럼 SELECT 권한을 주지 않기 위해서다 — app/log/page.tsx 참고).
  const { data: hospitalRows } = await supabase.rpc("get_public_hospital_v2", {
    p_qr_token: body.hospital_token ?? null,
    p_hospital_code: body.hospital_token ? null : (body.hospital_code as string),
  });

  const hospital = hospitalRows?.[0] ?? null;

  if (!hospital || hospital.status !== "active") {
    return NextResponse.json({ error: "병원 정보를 찾을 수 없습니다." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  const consentPayload = body.consents as Record<ConsentKey, boolean>;

  const { data, error } = await admin.rpc("register_case_v3", {
    p_hospital_id: hospital.hospital_id,
    p_patient_name: body.patient_name,
    p_patient_birth_date: patientBirthDate,
    p_patient_phone: body.patient_phone || null,
    p_patient_gender: body.patient_gender || null,
    p_relationship: body.relationship,
    p_diagnosis_name: body.diagnosis_name || null,
    p_room_no: body.room_no || null,
    p_insurance_company: body.insurance_company || null,
    p_accident_type: body.accident_type || null,
    p_accident_type_etc: body.accident_type_etc || null,
    p_planner_name: body.planner_name || null,
    p_planner_phone: body.planner_phone || null,
    p_care_start_date: body.care_start_date || null,
    p_care_end_date: body.care_end_date || null,
    p_memo: body.memo || null,
    p_privacy_agreed: Boolean(body.privacy_agreed),
    p_caregiver_name: caregiverName,
    p_caregiver_phone_normalized: caregiverPhoneNormalized,
    p_resident_number_masked: residentNumberMasked,
    p_resident_number_ciphertext: residentNumberCiphertext,
    p_resident_number_iv: residentNumberIv,
    p_resident_number_auth_tag: residentNumberAuthTag,
    p_resident_number_key_version: residentNumberKeyVersion,
    p_consent_version: body.consent_version,
    p_consent_integrated_care_ward: consentPayload.integrated_care_ward_confirmed,
    p_consent_direct_care: consentPayload.direct_care_confirmed,
    p_consent_false_application: consentPayload.false_application_confirmed,
    p_consent_insurance_not_guaranteed: consentPayload.insurance_not_guaranteed_confirmed,
    p_consent_information_accuracy: consentPayload.information_accuracy_confirmed,
    p_consent_privacy: consentPayload.privacy_consent_confirmed,
    p_admission_status: body.admission_status || null,
    p_insurance_company_other: insuranceCompanyOther,
  });

  if (error) {
    // 에러 메시지만 남기고, 요청 body나 주민등록번호 관련 값은 로그에
    // 남기지 않는다.
    console.error("register_case_v3 실패:", error.message);
    const mapped = mapRpcError(error.message);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  const result = Array.isArray(data) ? data[0] : data;

  if (!result) {
    return NextResponse.json({ error: "등록 처리에 실패했습니다." }, { status: 500 });
  }

  if (!hasExistingSession && result.out_caregiver_id) {
    await issueCaregiverSession(result.out_caregiver_id);
  }

  if (!result.out_is_existing) {
    const { error: historyError } = await admin.from("case_history").insert({
      case_id: result.out_case_id,
      history_type: "REGISTER",
      title: "사례 등록",
      action: "최초 등록",
      description: "병원 QR을 통해 사례가 등록되었습니다.",
      actor: caregiverName,
      after_data: { case_no: result.out_case_no },
    });

    if (historyError) {
      console.error("case_history insert 실패:", historyError);
    }

    // 신규 사례일 때만 기존 가족간병관리 시스템으로 등록정보를 자동
    // 전송한다(작업 D — "전자일지 최초등록 성공 시"). 기존 사례 재사용
    // 분기는 이미 최초 등록 시점에 전송이 끝났으므로 다시 보내지 않는다.
    // 전송 실패(웹훅 미설정 포함)는 등록 자체를 절대 실패시키지 않는다 —
    // syncCaseToLegacySystem 내부에서 실패해도 cases.legacy_sync_status만
    // 'failed'로 남기고 정상 반환하지만, 예상치 못한 예외까지 등록 응답을
    // 막지 않도록 이 호출 자체도 try/catch로 감싼다.
    //
    // 이 전송은 응답을 막지 않는다 — Apps Script(Sheet 저장)와 그 뒤의
    // 알림톡 발송까지 왕복하면 수 초가 걸리는데, DB 등록이 이미 끝난
    // 사용자를 그동안 기다리게 할 이유가 없다. next/server의 after()는
    // 응답을 보낸 뒤 콜백을 실행하되, Vercel에서는 waitUntil()에 연결되어
    // 콜백이 끝날 때까지 함수 인스턴스의 수명을 연장한다 — await만 지운
    // fire-and-forget과 달리, 응답 직후 인스턴스가 회수되면서 전송이
    // 중간에 끊기는 일이 없다. 호출 조건(신규 사례 1회)과 예외 격리는
    // 위 설명 그대로 유지되고, 상태 전이(pending → synced/failed)도
    // lib/legacy-sync.ts가 하던 대로 그대로 수행한다.
    after(async () => {
      try {
        await syncCaseToLegacySystem(result.out_case_id);
      } catch (syncError) {
        console.error(
          "legacy sync 처리 중 예외:",
          syncError instanceof Error ? syncError.message : "알 수 없는 오류"
        );
      }
    });
  }

  // register_case_v3는 caregiver/case/case_caregiver/case_consent를
  // 하나의 트랜잭션으로 원자적으로 생성하므로(RPC가 성공을 반환했다면
  // 넷 다 존재해야 정상이다), 실제로 그런지 건수만 확인해 응답에 boolean
  // 플래그로 담는다 — 개인정보 원문은 전혀 조회/반환하지 않는다. 이 확인
  // 자체가 실패해도 등록 자체는 이미 완료된 것이므로 등록을 실패 처리하지
  // 않고, 플래그만 false로 내려 관리자 화면(작업 A/C)에서 드러나게 한다.
  const { count: linkedCaregiverCount } = await admin
    .from("case_caregivers")
    .select("*", { count: "exact", head: true })
    .eq("case_id", result.out_case_id)
    .eq("status", "활성");

  const { count: consentRecordCount } = await admin
    .from("case_consents")
    .select("*", { count: "exact", head: true })
    .eq("case_id", result.out_case_id);

  // 응답에는 주민등록번호 관련 값(원문/마스킹/암호문 모두)을 절대 포함하지
  // 않는다.
  return NextResponse.json({
    ok: true,
    case_id: result.out_case_id,
    case_no: result.out_case_no,
    family_code: result.out_family_code,
    is_existing: result.out_is_existing,
    caregiver_linked: (linkedCaregiverCount || 0) > 0,
    consent_recorded: (consentRecordCount || 0) > 0,
  });
}
