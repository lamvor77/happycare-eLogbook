import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminApi } from "@/lib/admin-auth";

interface RestoreCareLogBody {
  reason?: string;
}

const REASON_MIN_LENGTH = 5;
const REASON_MAX_LENGTH = 500;

export async function POST(
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

  const { supabase, email } = auth;
  const { id: logId } = await params;

  let body: RestoreCareLogBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (reason.length < REASON_MIN_LENGTH || reason.length > REASON_MAX_LENGTH) {
    return NextResponse.json(
      {
        error: `복원 사유는 ${REASON_MIN_LENGTH}자 이상 ${REASON_MAX_LENGTH}자 이하로 입력해주세요.`,
      },
      { status: 400 }
    );
  }

  // 클라이언트가 case_id/caregiver_id를 함께 보내더라도 신뢰하지 않는다 —
  // log_id로만 서버에서 대상 기록과 소속 사례를 조회한다.
  const { data: careLog, error: fetchError } = await supabase
    .from("care_logs")
    .select("log_id, case_id, care_date, deleted_at")
    .eq("log_id", logId)
    .maybeSingle();

  if (fetchError || !careLog) {
    return NextResponse.json({ error: "간병일지를 찾을 수 없습니다." }, { status: 404 });
  }

  if (!careLog.deleted_at) {
    return NextResponse.json({ error: "삭제되지 않은 간병일지입니다." }, { status: 409 });
  }

  // 같은 사례·같은 날짜에 이미 활성 상태인 다른 간병일지가 있으면 복원할 수
  // 없다(하루 1건 제한). 이 확인은 사용자 경험을 위한 선제 검사이고, 최종
  // 방어는 uq_care_logs_case_date_active 부분 유니크 인덱스(아래 UPDATE에서
  // 23505로 감지)가 담당한다.
  const { data: conflictingLog, error: conflictError } = await supabase
    .from("care_logs")
    .select("log_id")
    .eq("case_id", careLog.case_id)
    .eq("care_date", careLog.care_date)
    .is("deleted_at", null)
    .neq("log_id", logId)
    .maybeSingle();

  if (conflictError) {
    console.error("복원 충돌 확인 실패:", conflictError.message);
    return NextResponse.json({ error: "복원 처리 중 오류가 발생했습니다." }, { status: 500 });
  }

  if (conflictingLog) {
    return NextResponse.json(
      { error: "같은 날짜에 이미 활성 상태인 간병일지가 있어 복원할 수 없습니다." },
      { status: 409 }
    );
  }

  const { data: restoredLog, error: updateError } = await supabase
    .from("care_logs")
    .update({
      deleted_at: null,
      deleted_by: null,
      delete_reason: null,
    })
    .eq("log_id", logId)
    .not("deleted_at", "is", null)
    .select("log_id")
    .maybeSingle();

  if (updateError) {
    // 동시 요청으로 위 사전 검사 이후에 다른 활성 일지가 먼저 생겼다면,
    // 부분 유니크 인덱스 위반(23505)으로 여기서 최종 차단된다.
    if (updateError.code === "23505") {
      return NextResponse.json(
        { error: "같은 날짜에 이미 활성 상태인 간병일지가 있어 복원할 수 없습니다." },
        { status: 409 }
      );
    }

    console.error("간병일지 복원 실패:", updateError.message);
    return NextResponse.json({ error: "복원 처리에 실패했습니다." }, { status: 500 });
  }

  if (!restoredLog) {
    // 동시 요청으로 이미 다른 관리자가 복원(또는 재삭제)했을 수 있다.
    return NextResponse.json({ error: "삭제되지 않은 간병일지입니다." }, { status: 409 });
  }

  // 실제 상태 변경(UPDATE)이 성공한 뒤에만 이력을 남긴다 — 이력만 남고
  // 상태는 그대로인 상황을 피하기 위해 순서를 반대로 하지 않는다. 이력
  // 기록 자체가 실패해도(드문 경우) 복원은 이미 완료된 것으로 처리하고
  // 서버 로그에만 남긴다(다른 관리자 액션들과 동일한 관례).
  const { error: historyError } = await supabase.from("case_history").insert({
    case_id: careLog.case_id,
    history_type: "CARE_LOG_RESTORE",
    title: "간병일지 복원",
    action: "간병일지 복원",
    description: `관리자(${email})가 ${careLog.care_date} 간병일지를 복원했습니다. 사유: ${reason}`,
    actor: email,
  });

  if (historyError) {
    console.error("case_history insert 실패:", historyError.message);
  }

  return NextResponse.json({ ok: true });
}
