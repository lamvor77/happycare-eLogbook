import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAuthUser } from "@/lib/caregiver-auth";
import { maskResidentNumberFront7 } from "@/lib/resident-number";

interface RegisterRequestBody {
  hospital_token?: string;
  hospital_code?: string;
  caregiver_name?: string;
  caregiver_phone?: string;
  resident_number_front7?: string;
  patient_name?: string;
  patient_birth_date?: string;
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
  privacy_agreed?: boolean;
}

function mapRpcError(message: string): { status: number; error: string } {
  if (message.includes("not_authenticated")) {
    return { status: 401, error: "로그인이 필요합니다." };
  }

  if (message.includes("privacy_not_agreed")) {
    return { status: 400, error: "개인정보 수집 및 이용에 동의해주세요." };
  }

  if (message.includes("invalid_hospital")) {
    return { status: 400, error: "병원 정보를 찾을 수 없습니다." };
  }

  return { status: 500, error: "등록 처리에 실패했습니다." };
}

export async function POST(request: Request) {
  const { supabase: authedSupabase, user } = await getAuthUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: RegisterRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  if (
    !body.caregiver_name ||
    !body.caregiver_phone ||
    !body.patient_name ||
    !body.relationship
  ) {
    return NextResponse.json({ error: "필수 정보를 입력해주세요." }, { status: 400 });
  }

  if (!body.hospital_token && !body.hospital_code) {
    return NextResponse.json({ error: "병원 정보를 찾을 수 없습니다." }, { status: 400 });
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

  let hospitalQuery = supabase
    .from("hospitals")
    .select("hospital_id, status");

  hospitalQuery = body.hospital_token
    ? hospitalQuery.eq("qr_token", body.hospital_token)
    : hospitalQuery.eq("hospital_code", body.hospital_code as string);

  const { data: hospital } = await hospitalQuery.maybeSingle();

  if (!hospital || hospital.status !== "active") {
    return NextResponse.json({ error: "병원 정보를 찾을 수 없습니다." }, { status: 400 });
  }

  const { data, error } = await authedSupabase.rpc("register_case", {
    p_hospital_id: hospital.hospital_id,
    p_patient_name: body.patient_name,
    p_patient_birth_date: body.patient_birth_date || null,
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
    p_caregiver_name: body.caregiver_name,
    p_caregiver_phone_normalized: body.caregiver_phone,
    p_resident_number_masked: residentNumberMasked,
  });

  if (error) {
    console.error("register_case 실패:", error.message);
    const mapped = mapRpcError(error.message);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  const result = Array.isArray(data) ? data[0] : data;

  if (!result) {
    return NextResponse.json({ error: "등록 처리에 실패했습니다." }, { status: 500 });
  }

  if (!result.out_is_existing) {
    const { error: historyError } = await authedSupabase.from("case_history").insert({
      case_id: result.out_case_id,
      history_type: "REGISTER",
      title: "사례 등록",
      action: "최초 등록",
      description: "병원 QR을 통해 사례가 등록되었습니다.",
      actor: body.caregiver_name,
      after_data: { case_no: result.out_case_no },
    });

    if (historyError) {
      console.error("case_history insert 실패:", historyError);
    }
  }

  return NextResponse.json({
    ok: true,
    case_id: result.out_case_id,
    case_no: result.out_case_no,
    family_code: result.out_family_code,
    is_existing: result.out_is_existing,
  });
}
