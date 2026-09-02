import { NextResponse } from "next/server";
import { CaregiverAuthError, requireCurrentCaregiverSession } from "@/lib/caregiver-auth";
import { isSameOriginRequest, sameOriginErrorResponse } from "@/lib/request-guard";

interface ChangeCaregiverRequestBody {
  case_caregiver_id?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSameOriginRequest(request)) {
    return sameOriginErrorResponse();
  }

  const { id: caseId } = await params;

  let auth;
  try {
    auth = await requireCurrentCaregiverSession(caseId);
  } catch (error) {
    if (error instanceof CaregiverAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const { supabase, caregiver, caseCaregiver } = auth;

  let body: ChangeCaregiverRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  const targetId = body.case_caregiver_id;

  if (!targetId || typeof targetId !== "string") {
    return NextResponse.json({ error: "변경할 간병인을 선택해주세요." }, { status: 400 });
  }

  if (targetId === caseCaregiver.case_caregiver_id) {
    return NextResponse.json({ error: "이미 대표 간병인입니다." }, { status: 400 });
  }

  const { data: targetCaregiver, error: targetError } = await supabase
    .from("case_caregivers")
    .select("*, caregivers (caregiver_name)")
    .eq("case_caregiver_id", targetId)
    .eq("case_id", caseId)
    .eq("status", "활성")
    .maybeSingle();

  if (targetError || !targetCaregiver) {
    return NextResponse.json(
      { error: "변경할 간병인 정보를 찾을 수 없습니다." },
      { status: 400 }
    );
  }

  const { error: rpcError } = await supabase.rpc("set_current_caregiver_v2", {
    p_case_id: caseId,
    p_requesting_caregiver_id: caregiver.caregiver_id,
    p_new_case_caregiver_id: targetId,
  });

  if (rpcError) {
    console.error("set_current_caregiver 실패:", rpcError);
    return NextResponse.json(
      {
        error:
          "대표 간병인 변경에 실패했습니다. 잠시 후 다시 시도해주세요.",
      },
      { status: 500 }
    );
  }

  const { error: historyError } = await supabase.from("case_history").insert({
    case_id: caseId,
    history_type: "CAREGIVER_CHANGE",
    title: "현재 간병인 변경",
    action: "현재 간병인 변경",
    description: `${caregiver.caregiver_name || "-"}님이 현재 간병인을 ${
      targetCaregiver.caregivers?.caregiver_name || "-"
    }님으로 변경했습니다.`,
    actor: caregiver.caregiver_name || "현재 간병인",
    created_by_id: caregiver.caregiver_id,
    before_data: { case_caregiver_id: caseCaregiver.case_caregiver_id },
    after_data: { case_caregiver_id: targetId },
  });

  if (historyError) {
    console.error("case_history insert 실패:", historyError);
  }

  return NextResponse.json({ ok: true });
}
