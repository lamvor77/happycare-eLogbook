import { NextResponse } from "next/server";
import { CaregiverAuthError, requireActiveCaseMemberSession } from "@/lib/caregiver-auth";
import { isSameOriginRequest, sameOriginErrorResponse } from "@/lib/request-guard";
import { getCareLogToday } from "@/lib/care-log-date";
import { readQrPass } from "@/lib/qr-pass-cookie";
import { checkQrPassAgainstCase, QR_PASS_REQUIRED_MESSAGE } from "@/lib/qr-pass";

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
    auth = await requireActiveCaseMemberSession(caseId);
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

  // 새 간병일지는 "병원에 비치된 QR을 스캔한 뒤" 작성한다(운영 정책,
  // 2026-09-05 확정). 그 사실은 /log/enter가 심은 증표(hc_qr_pass)로
  // 확인한다 — 세션·구성원·입원중 검사를 모두 통과한 뒤에 보므로 위의
  // 401/403/400 의미는 그대로다. 북마크·직접 URL·API 직접 호출로는 이
  // 지점을 지나지 못한다. 정정(PATCH)·사진·조회는 이 검사를 하지 않는다.
  const qrPassCheck = checkQrPassAgainstCase(await readQrPass(), caseData.hospital_id);

  if (!qrPassCheck.allowed) {
    return NextResponse.json({ error: QR_PASS_REQUIRED_MESSAGE }, { status: 403 });
  }

  if (qrPassCheck.unbound) {
    // 사례에 hospital_id가 없어 병원 결속 없이 허용한 경우. 구글 설문지
    // 경로의 병원 매핑이 들어오면 사라져야 할 경고다. 사례 ID만 남긴다.
    console.warn("QR pass 병원 결속 없이 간병일지 작성 허용(사례 hospital_id 없음):", caseId);
  }

  const today = getCareLogToday();

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
