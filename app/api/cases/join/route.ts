import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getCaregiverSession } from "@/lib/caregiver-auth";
import { issueCaregiverSession } from "@/lib/caregiver-session";
import { consumeVerifiedOtp } from "@/lib/otp";
import { toE164 } from "@/lib/phone";
import { maskResidentNumberFront7 } from "@/lib/resident-number";
import { isSameOriginRequest, sameOriginErrorResponse } from "@/lib/request-guard";

interface JoinRequestBody {
  family_code?: string;
  relationship?: string;
  caregiver_name?: string;
  caregiver_phone?: string;
  resident_number_front7?: string;
}

function mapRpcError(message: string): { status: number; error: string } {
  if (message.includes("invalid_family_code")) {
    return { status: 400, error: "가족코드와 일치하는 환자를 찾을 수 없습니다." };
  }

  if (message.includes("invalid_caregiver_phone")) {
    return { status: 400, error: "휴대폰번호를 확인해주세요." };
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

  if (!body.family_code || !body.relationship) {
    return NextResponse.json({ error: "필수 정보를 입력해주세요." }, { status: 400 });
  }

  const existingSession = await getCaregiverSession();

  let caregiverName: string;
  let caregiverPhoneNormalized: string;
  let hasExistingSession = false;

  if (existingSession) {
    hasExistingSession = true;
    caregiverName = existingSession.caregiver.caregiver_name;
    caregiverPhoneNormalized = existingSession.caregiver.phone_normalized;
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
  }

  let residentNumberMasked: string | null = null;

  if (body.resident_number_front7 && body.resident_number_front7.trim()) {
    residentNumberMasked = maskResidentNumberFront7(body.resident_number_front7);

    if (!residentNumberMasked) {
      return NextResponse.json(
        { error: "주민등록번호 앞 7자리를 올바르게 입력해주세요." },
        { status: 400 }
      );
    }
  }

  const admin = createSupabaseAdminClient();

  const { data, error } = await admin.rpc("join_case_v2", {
    p_family_code: body.family_code,
    p_relationship: body.relationship,
    p_caregiver_name: caregiverName,
    p_caregiver_phone_normalized: caregiverPhoneNormalized,
    p_resident_number_masked: residentNumberMasked,
  });

  if (error) {
    console.error("join_case_v2 실패:", error.message);
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

  if (!result.out_already_joined) {
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
  }

  return NextResponse.json({
    ok: true,
    case_id: result.out_case_id,
    patient_name: result.out_patient_name,
    already_joined: result.out_already_joined,
  });
}
