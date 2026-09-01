import { NextResponse } from "next/server";
import { CaregiverAuthError, requireActiveCaseMemberSession } from "@/lib/caregiver-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isSameOriginRequest, sameOriginErrorResponse } from "@/lib/request-guard";

/**
 * 간병일지 위치정보 수집·이용 동의 여부를 1회 기록한다.
 *
 * 간병일지 작성 화면은 "이 간병인이 이 사례에서 처음 일지를 쓸 때"만 동의를
 * 묻고, 그 선택을 기억한다. 그 선택을 저장하는 곳이 이 라우트다.
 *
 * 저장 단위는 (case_id, caregiver_id) — case_caregivers 행이다. 같은 사례라도
 * 간병인마다 행이 다르므로 다른 간병인의 동의가 상속되지 않는다.
 *
 * 일지 저장(POST /api/cases/[id]/care-logs)과 분리한 이유: 사용자가 "동의하고
 * 위치 확인"을 누르면 그 즉시 브라우저 위치 요청이 시작되는데, 그 뒤에 일지를
 * 저장하지 않고 화면을 떠날 수 있다. 선택을 일지 저장 시점에만 기록하면 그런
 * 경우 선택이 사라져 다음 방문에 또 묻게 된다 — "1회만 묻는다"는 정책이
 * 깨진다.
 *
 * 위치 좌표는 이 라우트가 다루지 않는다(동의 여부만 기록한다).
 */

interface LocationConsentBody {
  consent?: boolean;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSameOriginRequest(request)) {
    return sameOriginErrorResponse();
  }

  const { id: caseId } = await params;

  // 간병일지 작성 화면과 동일한 권한을 요구한다 — 로그인 + 이 사례의 현재
  // 간병인 본인 + 사례가 아직 진행 중. 클라이언트가 보낸 caregiver_id는
  // 쓰지 않고 세션으로만 신원을 정한다.
  let auth;

  try {
    auth = await requireActiveCaseMemberSession(caseId);
  } catch (error) {
    if (error instanceof CaregiverAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }

  let body: LocationConsentBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  if (typeof body.consent !== "boolean") {
    return NextResponse.json(
      { error: "동의 여부가 올바르지 않습니다." },
      { status: 400 }
    );
  }

  const admin = createSupabaseAdminClient();

  // 이미 선택한 적이 있으면 덮어쓰지 않는다. 최초 1회 선택을 기억하는 것이
  // 이 기능의 목적이고, 같은 화면에서 중복 요청이 오더라도 처음 선택과
  // 그 시각이 그대로 남아야 감사 추적이 어긋나지 않는다. 선택을 바꾸는
  // 기능은 이번 범위에 없다.
  const { data, error } = await admin
    .from("case_caregivers")
    .update({
      location_consent: body.consent,
      location_consent_at: new Date().toISOString(),
    })
    .eq("case_caregiver_id", auth.caseCaregiver.case_caregiver_id)
    .is("location_consent", null)
    .select("case_caregiver_id")
    .maybeSingle();

  if (error) {
    // 원문 메시지를 사용자에게 노출하지 않는다.
    console.error("위치정보 동의 저장 실패:", error.message);
    return NextResponse.json(
      { error: "동의 정보를 저장하지 못했습니다." },
      { status: 500 }
    );
  }

  // data가 null이면 이미 선택한 이력이 있어 갱신 대상이 없었다는 뜻이다.
  // 오류가 아니라 정상(멱등) 동작이므로 성공으로 응답한다.
  return NextResponse.json({ ok: true, already_decided: data === null });
}
