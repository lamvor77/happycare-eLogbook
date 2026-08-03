import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/caregiver-auth";
import { maskResidentNumberFront7 } from "@/lib/resident-number";

interface JoinRequestBody {
  family_code?: string;
  relationship?: string;
  caregiver_name?: string;
  caregiver_phone?: string;
  resident_number_front7?: string;
}

function mapRpcError(message: string): { status: number; error: string } {
  if (message.includes("not_authenticated")) {
    return { status: 401, error: "로그인이 필요합니다." };
  }

  if (message.includes("invalid_family_code")) {
    return { status: 400, error: "가족코드와 일치하는 환자를 찾을 수 없습니다." };
  }

  return { status: 500, error: "참여 처리에 실패했습니다." };
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuthUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: JoinRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  if (!body.family_code || !body.caregiver_name || !body.caregiver_phone || !body.relationship) {
    return NextResponse.json({ error: "필수 정보를 입력해주세요." }, { status: 400 });
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

  const { data, error } = await supabase.rpc("join_case", {
    p_family_code: body.family_code,
    p_relationship: body.relationship,
    p_caregiver_name: body.caregiver_name,
    p_caregiver_phone_normalized: body.caregiver_phone,
    p_resident_number_masked: residentNumberMasked,
  });

  if (error) {
    console.error("join_case 실패:", error.message);
    const mapped = mapRpcError(error.message);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  const result = Array.isArray(data) ? data[0] : data;

  if (!result) {
    return NextResponse.json({ error: "참여 처리에 실패했습니다." }, { status: 500 });
  }

  if (!result.out_already_joined) {
    const { error: historyError } = await supabase.from("case_history").insert({
      case_id: result.out_case_id,
      history_type: "JOIN",
      title: "가족간병인 참여",
      action: "가족간병인 참여",
      description: `${body.caregiver_name}님이 가족간병인으로 참여했습니다.`,
      actor: body.caregiver_name,
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
