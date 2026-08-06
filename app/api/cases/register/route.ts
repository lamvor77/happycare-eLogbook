import { NextResponse } from "next/server";
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
  normalizePatientBirthDateParts,
  isConsentComplete,
  type BirthCentury,
} from "@/lib/registration-validation";
import type { ConsentKey } from "@/lib/registration-options";
import { isSameOriginRequest, sameOriginErrorResponse } from "@/lib/request-guard";

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
  patient_birth_yymmdd?: string;
  patient_birth_century?: BirthCentury;
  patient_phone?: string;
  patient_gender?: string;
  relationship?: string;
  diagnosis_name?: string;
  room_no?: string;
  insurance_company?: string;
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

  // admission_status(입원 예정/당일/중)는 DB 컬럼이 없어 이번 단계에서는
  // 저장하지 않는다(docs/registration-field-mapping.md 참고). 값을 받되
  // RPC에는 전달하지 않는다 — 향후 컬럼이 추가되면 여기서 매핑한다.

  let patientBirthDate: string | null = null;

  if (body.patient_birth_yymmdd) {
    if (!body.patient_birth_century) {
      return NextResponse.json(
        { error: "환자 생년월일의 출생연도대를 선택해주세요." },
        { status: 400 }
      );
    }

    patientBirthDate = normalizePatientBirthDateParts(
      body.patient_birth_yymmdd,
      body.patient_birth_century
    );

    if (!patientBirthDate) {
      return NextResponse.json(
        { error: "환자 생년월일 6자리를 정확히 입력해주세요." },
        { status: 400 }
      );
    }
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

  let hospitalQuery = supabase.from("hospitals").select("hospital_id, status");

  hospitalQuery = body.hospital_token
    ? hospitalQuery.eq("qr_token", body.hospital_token)
    : hospitalQuery.eq("hospital_code", body.hospital_code as string);

  const { data: hospital } = await hospitalQuery.maybeSingle();

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
