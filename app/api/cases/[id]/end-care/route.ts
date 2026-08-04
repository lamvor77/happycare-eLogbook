import { NextResponse } from "next/server";
import { CaregiverAuthError, requireCurrentCaregiverSession } from "@/lib/caregiver-auth";
import { revokeAllSessionsForCaregiver } from "@/lib/caregiver-session";
import { isSameOriginRequest, sameOriginErrorResponse } from "@/lib/request-guard";

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

  const { supabase, caregiver } = auth;

  const { data: caseData, error: caseError } = await supabase
    .from("cases")
    .select("case_id, status")
    .eq("case_id", caseId)
    .single();

  if (caseError || !caseData) {
    return NextResponse.json({ error: "사례 정보를 찾을 수 없습니다." }, { status: 404 });
  }

  if (caseData.status === "간병종료") {
    return NextResponse.json({ error: "이미 종료된 사례입니다." }, { status: 409 });
  }

  const today = new Date().toISOString().slice(0, 10);

  const { error: updateError } = await supabase
    .from("cases")
    .update({ status: "간병종료", care_end_date: today })
    .eq("case_id", caseId);

  if (updateError) {
    console.error("간병종료 처리 실패:", updateError);
    return NextResponse.json({ error: "간병 종료 처리에 실패했습니다." }, { status: 500 });
  }

  const { error: historyError } = await supabase.from("case_history").insert({
    case_id: caseId,
    history_type: "END",
    title: "간병종료",
    action: "간병종료",
    description: `간병이 종료되었습니다. 종료일: ${today}`,
    actor: caregiver.caregiver_name || "현재 간병인",
    created_by_id: caregiver.caregiver_id,
    before_data: { status: caseData.status },
    after_data: { status: "간병종료", care_end_date: today },
  });

  if (historyError) {
    console.error("case_history insert 실패:", historyError);
  }

  // 이 caregiver가 다른 입원중 사례에도 연결되어 있으면 세션은 유지한다.
  // 다른 활성 사례가 전혀 없을 때만 세션을 해제한다.
  const { data: otherActiveLinks } = await supabase
    .from("case_caregivers")
    .select("case_id, cases!inner(status)")
    .eq("caregiver_id", caregiver.caregiver_id)
    .eq("status", "활성")
    .eq("cases.status", "입원중")
    .neq("case_id", caseId);

  if (!otherActiveLinks || otherActiveLinks.length === 0) {
    await revokeAllSessionsForCaregiver(caregiver.caregiver_id);
  }

  return NextResponse.json({ ok: true });
}
