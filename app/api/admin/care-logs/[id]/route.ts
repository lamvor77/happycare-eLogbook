import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminApi } from "@/lib/admin-auth";

interface DeleteCareLogBody {
  reason?: string;
}

const REASON_MIN_LENGTH = 5;
const REASON_MAX_LENGTH = 500;

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let auth;
  try {
    auth = await requireAdminApi();
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const { supabase, user, email } = auth;
  const { id: logId } = await params;

  let body: DeleteCareLogBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (reason.length < REASON_MIN_LENGTH || reason.length > REASON_MAX_LENGTH) {
    return NextResponse.json(
      {
        error: `삭제 사유는 ${REASON_MIN_LENGTH}자 이상 ${REASON_MAX_LENGTH}자 이하로 입력해주세요.`,
      },
      { status: 400 }
    );
  }

  const { data: careLog, error: fetchError } = await supabase
    .from("care_logs")
    .select("log_id, case_id, care_date, deleted_at")
    .eq("log_id", logId)
    .maybeSingle();

  if (fetchError || !careLog) {
    return NextResponse.json({ error: "간병일지를 찾을 수 없습니다." }, { status: 404 });
  }

  if (careLog.deleted_at) {
    return NextResponse.json({ error: "이미 삭제된 간병일지입니다." }, { status: 409 });
  }

  const { error: updateError } = await supabase
    .from("care_logs")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: user.id,
      delete_reason: reason,
    })
    .eq("log_id", logId)
    .is("deleted_at", null);

  if (updateError) {
    console.error("간병일지 삭제 실패:", updateError.message);
    return NextResponse.json({ error: "삭제 처리에 실패했습니다." }, { status: 500 });
  }

  const { error: historyError } = await supabase.from("case_history").insert({
    case_id: careLog.case_id,
    history_type: "CARE_LOG_DELETE",
    title: "간병일지 삭제",
    action: "간병일지 삭제",
    description: `관리자(${email})가 ${careLog.care_date} 간병일지를 삭제했습니다. 사유: ${reason}`,
    actor: email,
  });

  if (historyError) {
    console.error("case_history insert 실패:", historyError.message);
  }

  return NextResponse.json({ ok: true });
}
