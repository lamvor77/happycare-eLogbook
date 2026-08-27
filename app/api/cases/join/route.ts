import { NextResponse, after } from "next/server";
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
import { isConsentComplete } from "@/lib/registration-validation";
import type { ConsentKey } from "@/lib/registration-options";
import { isSameOriginRequest, sameOriginErrorResponse } from "@/lib/request-guard";
import { syncCaregiverRegistrationToLegacySystem } from "@/lib/legacy-sync-registration";

/**
 * 가족간병인 추가 참여.
 *
 * 최초 등록(app/api/cases/register)과 같은 수준으로 맞춘다:
 *   - 주민등록번호 13자리를 받아 암호화해 저장한다(앞 7자리 마스킹만 받던
 *     기존 join_case_v2 방식을 더 이상 쓰지 않는다).
 *   - 이 간병인 본인의 동의 6개를 직접 받는다(최초 간병인의 동의를 복사하지
 *     않는다).
 *   - 새 E등록번호를 발급해 등록 건(caregiver_registrations)을 만든다.
 *   - 기존 시스템 전송은 응답 이후 after() 콜백에서 수행한다.
 *
 * join_case_v2는 삭제하지 않았다(호환/롤백용) — 이 라우트만 v3를 호출한다.
 */

interface JoinRequestBody {
  family_code?: string;
  relationship?: string;
  caregiver_name?: string;
  caregiver_phone?: string;
  // 추가 간병인 주민등록번호 전체 13자리(하이픈 유무 무관). 암호화 직후
  // 더 이상 참조하지 않는다 — 응답/로그 어디에도 넣지 않는다.
  resident_number?: string;
  consent_version?: string;
  consents?: Partial<Record<ConsentKey, boolean>>;
}

function mapRpcError(message: string): { status: number; error: string } {
  if (message.includes("invalid_family_code")) {
    return { status: 400, error: "가족코드와 일치하는 환자를 찾을 수 없습니다." };
  }

  if (message.includes("case_already_ended")) {
    return { status: 400, error: "이미 간병이 종료된 사례입니다." };
  }

  if (message.includes("invalid_caregiver_phone")) {
    return { status: 400, error: "휴대폰번호를 확인해주세요." };
  }

  if (message.includes("invalid_caregiver_name")) {
    return { status: 400, error: "간병인 성명을 확인해주세요." };
  }

  if (message.includes("invalid_relationship")) {
    return { status: 400, error: "환자와의 관계를 확인해주세요." };
  }

  if (message.includes("invalid_resident_number")) {
    return { status: 400, error: "간병인 주민등록번호를 확인해주세요." };
  }

  if (message.includes("consent_incomplete") || message.includes("invalid_consent_version")) {
    return { status: 400, error: "동의 항목을 모두 확인해주세요." };
  }

  // 같은 사례에 이미 등록된 간병인. RPC가 먼저 명시적으로 던지지만,
  // 동시 요청으로 그 확인을 지나쳤을 때는 UNIQUE 제약이 잡아준다 — 두
  // 경우 모두 같은 문구로 안내한다(원문 오류는 노출하지 않는다).
  if (
    message.includes("already_registered") ||
    message.includes("uq_caregiver_registrations_case_caregiver") ||
    message.includes("duplicate key value")
  ) {
    return {
      status: 409,
      error: "이미 이 환자의 가족간병인으로 참여하고 있습니다.",
    };
  }

  // 동의 기록이 여러 건이라 이번 참여의 근거를 특정할 수 없는 상태.
  // 임의로 하나를 골라 등록번호를 발급하지 않고 중단한다 — 사용자에게는
  // DB 구조를 드러내지 않는 안내만 준다.
  if (message.includes("ambiguous_consent")) {
    return {
      status: 409,
      error:
        "이전 동의 기록이 중복되어 참여를 진행할 수 없습니다. 관리자에게 문의해주세요.",
    };
  }

  return { status: 500, error: "참여 처리에 실패했습니다." };
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return sameOriginErrorResponse();
  }

  let body: JoinRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  // 요청 본문 전체를 로그로 남기지 않는다(주민등록번호 포함).

  if (!body.family_code || !body.relationship) {
    return NextResponse.json({ error: "필수 정보를 입력해주세요." }, { status: 400 });
  }

  if (!isConsentComplete(body.consents || {})) {
    return NextResponse.json({ error: "동의 항목을 모두 확인해주세요." }, { status: 400 });
  }

  if (!body.consent_version) {
    return NextResponse.json({ error: "동의 정보를 확인해주세요." }, { status: 400 });
  }

  // 가족간병인 추가 참여는 브라우저에 기존 로그인 세션이 있더라도 본인확인을
  // 생략하지 않는다(운영 정책, 2026-08-27 확정) — 성명/주민등록번호/휴대폰
  // OTP를 매번 다시 받는다. 최초 등록(app/api/cases/register)이 세션이 있으면
  // OTP를 건너뛰는 것과 다른 점이며, 그 경로의 정책은 그대로 둔다.
  //
  // 세션 자체를 지우거나 로그인 정책을 바꾸지는 않는다 — 이 라우트가 세션을
  // "본인확인 통과"의 근거로 쓰지 않을 뿐이다. 신원은 오직 방금 OTP로 인증된
  // 전화번호로만 결정한다(다른 사람의 세션이 남아있는 기기에서 참여해도 그
  // 세션의 신원이 끼어들 수 없다).
  const existingSession = await getCaregiverSession();
  const hasExistingSession = Boolean(existingSession);

  if (!body.caregiver_name || !body.caregiver_phone) {
    return NextResponse.json({ error: "필수 정보를 입력해주세요." }, { status: 400 });
  }

  const caregiverName = body.caregiver_name;
  const caregiverPhoneNormalized = toE164(body.caregiver_phone);

  // 세션 유무와 무관하게 OTP 소비를 반드시 통과해야 join_case_v3를 호출한다.
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

  const residentNumberMasked = maskResidentNumber(digits13);

  const encrypted = encryptResidentNumber(digits13);
  const residentNumberCiphertext = encrypted.ciphertext;
  const residentNumberIv = encrypted.iv;
  const residentNumberAuthTag = encrypted.authTag;
  const residentNumberKeyVersion = encrypted.keyVersion;
  // 이 지점 이후로는 digits13(원문)을 더 이상 참조하지 않는다.

  const admin = createSupabaseAdminClient();

  const consentPayload = body.consents as Record<ConsentKey, boolean>;

  const { data, error } = await admin.rpc("join_case_v3", {
    p_family_code: body.family_code,
    p_relationship: body.relationship,
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
    // 에러 메시지만 남기고 요청 body나 주민등록번호 관련 값은 로그에
    // 남기지 않는다.
    console.error("join_case_v3 실패:", error.message);
    const mapped = mapRpcError(error.message);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  const result = Array.isArray(data) ? data[0] : data;

  if (!result) {
    return NextResponse.json({ error: "참여 처리에 실패했습니다." }, { status: 500 });
  }

  if (!hasExistingSession && result.out_caregiver_id) {
    await issueCaregiverSession(result.out_caregiver_id);
  }

  const { error: historyError } = await admin.from("case_history").insert({
    case_id: result.out_case_id,
    history_type: "JOIN",
    title: "가족간병인 참여",
    action: "가족간병인 참여",
    description: `${caregiverName}님이 가족간병인으로 참여했습니다.`,
    actor: caregiverName,
    after_data: { relationship: body.relationship },
  });

  if (historyError) {
    console.error("case_history insert 실패:", historyError);
  }

  // 기존 시스템 전송은 응답을 막지 않는다 — Apps Script 왕복에 수 초가
  // 걸리는데 DB 참여가 이미 끝난 사용자를 기다리게 할 이유가 없다.
  // next/server의 after()는 Vercel에서 waitUntil()에 연결되어 콜백이 끝날
  // 때까지 함수 인스턴스의 수명을 연장하므로, await만 지운 fire-and-forget과
  // 달리 응답 직후 인스턴스가 회수되면서 전송이 끊기지 않는다(최초 등록에서
  // 검증된 구조를 그대로 재사용한다).
  //
  // 상태 전이는 이 등록 건 기준이다: join_case_v3가 'pending'으로 만들어
  // 두고, 아래 함수가 'synced' 또는 'failed'로 확정한다.
  after(async () => {
    try {
      await syncCaregiverRegistrationToLegacySystem(result.out_registration_id);
    } catch (syncError) {
      console.error(
        "등록 건 legacy sync 처리 중 예외:",
        syncError instanceof Error ? syncError.message : "알 수 없는 오류"
      );
    }
  });

  // 응답에는 주민등록번호 관련 값을 절대 포함하지 않는다.
  return NextResponse.json({
    ok: true,
    case_id: result.out_case_id,
    patient_name: result.out_patient_name,
    registration_no: result.out_registration_no,
  });
}
