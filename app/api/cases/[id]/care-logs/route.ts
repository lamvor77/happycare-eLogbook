import { NextResponse } from "next/server";
import { CaregiverAuthError, requireCurrentCaregiverSession } from "@/lib/caregiver-auth";
import { isSameOriginRequest, sameOriginErrorResponse } from "@/lib/request-guard";

type LocationStatus = "checked" | "unavailable";

interface CareLogRequestBody {
  meal_assist?: boolean;
  move_assist?: boolean;
  toilet_assist?: boolean;
  hygiene_assist?: boolean;
  position_change?: boolean;
  memo?: string;
  location_status?: LocationStatus;
  latitude?: number | null;
  longitude?: number | null;
  location_checked_at?: string | null;
  location_failure_reason?: string | null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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

  let body: CareLogRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  if (body.location_status !== "checked" && body.location_status !== "unavailable") {
    return NextResponse.json(
      { error: "위치 확인 상태 값이 올바르지 않습니다." },
      { status: 400 }
    );
  }

  if (body.location_status === "checked") {
    if (!isFiniteNumber(body.latitude) || !isFiniteNumber(body.longitude)) {
      return NextResponse.json(
        { error: "위치 확인 완료 상태에는 위도/경도가 필요합니다." },
        { status: 400 }
      );
    }
  }

  if (body.location_status === "unavailable") {
    if (
      typeof body.location_failure_reason !== "string" ||
      body.location_failure_reason.trim() === ""
    ) {
      return NextResponse.json(
        { error: "위치 확인 불가 상태에는 미기록 사유가 필요합니다." },
        { status: 400 }
      );
    }
  }

  const { data: caseData, error: caseError } = await supabase
    .from("cases")
    .select("case_id, hospital_id, status")
    .eq("case_id", caseId)
    .single();

  if (caseError || !caseData) {
    return NextResponse.json({ error: "사례 정보를 찾을 수 없습니다." }, { status: 404 });
  }

  if (caseData.status !== "입원중") {
    return NextResponse.json(
      { error: "간병이 종료된 사례에는 간병일지를 작성할 수 없습니다." },
      { status: 400 }
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  // 관리자가 오늘 일지를 삭제(soft delete)했다면 다시 작성할 수 있어야
  // 하므로, 삭제된 행은 중복 작성 판정에서 제외한다.
  const { data: existingLogs, error: checkError } = await supabase
    .from("care_logs")
    .select("log_id")
    .eq("case_id", caseId)
    .eq("care_date", today)
    .is("deleted_at", null);

  if (checkError) {
    return NextResponse.json({ error: "기존 기록 확인에 실패했습니다." }, { status: 500 });
  }

  if (existingLogs && existingLogs.length > 0) {
    return NextResponse.json(
      { error: "오늘은 이미 작성된 간병일지가 있습니다." },
      { status: 409 }
    );
  }

  const { data: savedLog, error: insertError } = await supabase
    .from("care_logs")
    .insert({
      case_id: caseId,
      caregiver_id: caregiver.caregiver_id,
      hospital_id: caseData.hospital_id,
      care_date: today,

      meal_assist: Boolean(body.meal_assist),
      move_assist: Boolean(body.move_assist),
      toilet_assist: Boolean(body.toilet_assist),
      hygiene_assist: Boolean(body.hygiene_assist),
      position_change: Boolean(body.position_change),

      memo: typeof body.memo === "string" ? body.memo : "",
      relationship: caseCaregiver.relationship,
      writer_name: caregiver.caregiver_name,
      signature_name: caregiver.caregiver_name,

      hospital_confirmed: true,

      latitude: body.location_status === "checked" ? body.latitude : null,
      longitude: body.location_status === "checked" ? body.longitude : null,

      location_checked_at: body.location_checked_at || new Date().toISOString(),
      location_status: body.location_status,

      location_failure_reason:
        body.location_status === "unavailable" ? body.location_failure_reason : null,
    })
    .select()
    .single();

  if (insertError) {
    console.error("care_logs insert 실패:", insertError);

    if (insertError.code === "23505") {
      return NextResponse.json(
        { error: "오늘은 이미 작성된 간병일지가 있습니다." },
        { status: 409 }
      );
    }

    return NextResponse.json({ error: "간병일지 저장에 실패했습니다." }, { status: 500 });
  }

  const { error: historyError } = await supabase.from("case_history").insert({
    case_id: caseId,
    history_type: "CARELOG",
    title: "간병일지 작성",
    action: "간병일지 작성",
    description: `${today} 간병일지가 작성되었습니다.`,
    actor: caregiver.caregiver_name || "현재 간병인",
    created_by_id: caregiver.caregiver_id,
    after_data: {
      care_date: today,
      location_status: body.location_status,
    },
  });

  if (historyError) {
    console.error("case_history insert 실패:", historyError);
  }

  return NextResponse.json({ ok: true, log_id: savedLog.log_id }, { status: 201 });
}
