import { NextResponse } from "next/server";
import { CaregiverAuthError, requireCurrentCaregiverSession } from "@/lib/caregiver-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isSameOriginRequest, sameOriginErrorResponse } from "@/lib/request-guard";
import { isWithinCareLogEditWindow } from "@/lib/care-log-photo";

/**
 * 간병일지 정정(작성 후 짧은 창 안에서만).
 *
 * 간병일지는 증빙 기록이라 원래 작성 후 수정이 불가능했다(care_logs에는
 * UPDATE 정책이 없고 anon/authenticated에서 revoke까지 되어 있다). 다만
 * 체크 하나 잘못 누른 것 때문에 틀린 기록이 영구히 남는 것도 곤란해,
 * lib/care-log-photo.ts의 CARE_LOG_EDIT_WINDOW_MS 안에서만 정정을 허용한다.
 *
 * *** 무엇을 고칠 수 있는가 ***
 * 간병활동 5개와 특이사항만 고칠 수 있다. 위치정보와 간병일자는 고칠 수
 * 없다 — 위치는 그 시각 그 자리에서 측정된 값이라 나중에 바꿀 수 있으면
 * 기록의 의미가 사라지고, 날짜를 옮기는 것은 정정이 아니라 다른 기록을
 * 만드는 일이다. 사진은 별도 라우트(./photos)에서 같은 창 규칙으로 다룬다.
 *
 * *** RLS와 service_role ***
 * care_logs의 UPDATE 정책은 열지 않는다. service_role이 RLS를 우회하므로
 * 이 라우트만으로 통제된 수정이 가능하고, 클라이언트 직접 수정은 계속
 * 차단된 상태로 남는다.
 *
 * *** 이력 ***
 * 고치기 전 값을 case_history에 남긴다. 출력물에는 드러나지 않지만,
 * 나중에 "무엇을 언제 정정했는지" 설명할 수 있어야 하기 때문이다.
 */

interface UpdateBody {
  meal_assist?: boolean;
  move_assist?: boolean;
  toilet_assist?: boolean;
  hygiene_assist?: boolean;
  position_change?: boolean;
  memo?: string;
}

/** 고칠 수 있는 활동 항목. 이 목록에 없는 컬럼은 이 라우트가 건드리지 않는다. */
const ACTIVITY_FIELDS = [
  "meal_assist",
  "move_assist",
  "toilet_assist",
  "hygiene_assist",
  "position_change",
] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; logId: string }> }
) {
  if (!isSameOriginRequest(request)) {
    return sameOriginErrorResponse();
  }

  const { id: caseId, logId } = await params;

  let auth;

  try {
    auth = await requireCurrentCaregiverSession(caseId);
  } catch (error) {
    if (error instanceof CaregiverAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }

  let body: UpdateBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  for (const field of ACTIVITY_FIELDS) {
    if (typeof body[field] !== "boolean") {
      return NextResponse.json(
        { error: "간병활동 값이 올바르지 않습니다." },
        { status: 400 }
      );
    }
  }

  if (body.memo !== undefined && typeof body.memo !== "string") {
    return NextResponse.json({ error: "특이사항이 올바르지 않습니다." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  const { data: log } = await admin
    .from("care_logs")
    .select(
      "log_id, case_id, caregiver_id, care_date, created_at, deleted_at, meal_assist, move_assist, toilet_assist, hygiene_assist, position_change, memo"
    )
    .eq("log_id", logId)
    .maybeSingle();

  // 다른 사례의 일지 id를 넣어도 통하지 않도록 case_id까지 대조한다.
  if (!log || log.case_id !== caseId) {
    return NextResponse.json({ error: "간병일지를 찾을 수 없습니다." }, { status: 404 });
  }

  if (log.deleted_at) {
    return NextResponse.json({ error: "삭제된 간병일지입니다." }, { status: 400 });
  }

  // 현재 간병인이라도 남이 쓴 일지를 고칠 수는 없다.
  if (log.caregiver_id !== auth.caregiver.caregiver_id) {
    return NextResponse.json(
      { error: "본인이 작성한 간병일지만 수정할 수 있습니다." },
      { status: 403 }
    );
  }

  if (!isWithinCareLogEditWindow(log.created_at)) {
    return NextResponse.json(
      { error: "수정할 수 있는 시간이 지났습니다." },
      { status: 400 }
    );
  }

  const memo = body.memo ?? "";

  const { error: updateError } = await admin
    .from("care_logs")
    .update({
      meal_assist: body.meal_assist,
      move_assist: body.move_assist,
      toilet_assist: body.toilet_assist,
      hygiene_assist: body.hygiene_assist,
      position_change: body.position_change,
      memo,
    })
    .eq("log_id", logId);

  if (updateError) {
    console.error("care_logs update 실패:", updateError.message);
    return NextResponse.json({ error: "간병일지 수정에 실패했습니다." }, { status: 500 });
  }

  // 고치기 전 값을 남긴다. 개인정보가 아니라 활동 체크와 특이사항이며,
  // 특이사항은 작성자가 직접 쓴 본문이라 이력에도 그대로 담는다.
  const { error: historyError } = await admin.from("case_history").insert({
    case_id: caseId,
    history_type: "CARELOG",
    title: "간병일지 수정",
    action: "간병일지 수정",
    description: `${log.care_date} 간병일지가 수정되었습니다.`,
    actor: auth.caregiver.caregiver_name || "현재 간병인",
    created_by_id: auth.caregiver.caregiver_id,
    before_data: {
      meal_assist: log.meal_assist,
      move_assist: log.move_assist,
      toilet_assist: log.toilet_assist,
      hygiene_assist: log.hygiene_assist,
      position_change: log.position_change,
      memo: log.memo,
    },
    after_data: {
      meal_assist: body.meal_assist,
      move_assist: body.move_assist,
      toilet_assist: body.toilet_assist,
      hygiene_assist: body.hygiene_assist,
      position_change: body.position_change,
      memo,
    },
  });

  if (historyError) {
    // 이력 기록 실패가 이미 끝난 수정을 되돌릴 이유는 되지 않는다.
    console.error("case_history insert 실패:", historyError.message);
  }

  return NextResponse.json({ ok: true });
}
