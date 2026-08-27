import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminApi } from "@/lib/admin-auth";
import { syncCaseToLegacySystem } from "@/lib/legacy-sync";
import { canRetryLegacySync } from "@/lib/legacy-sync-pending";

/**
 * 관리자 전용 "기존 시스템 연동 다시 전송"(작업 F). 실패한 사례에 대해서만
 * 관리자가 수동으로 재시도한다 — lib/legacy-sync.ts와 완전히 동일한 로직을
 * 재사용하고, 여기서는 새 전송 로직을 만들지 않는다.
 *
 * 최초 등록의 전송이 응답 이후 after() 콜백에서 실행되도록 바뀌면서
 * (app/api/cases/register/route.ts), 'pending'은 "아직 시작 전"이 아니라
 * "지금 전송 중일 수 있는" 상태가 됐다. 그래서 이 API는 legacy_sync_status가
 * null이 아닌지만 보던 기존 검사에 더해, 실제로 재전송해도 안전한 상태인지를
 * lib/legacy-sync-pending.ts의 공통 조건으로 확인한다 — 화면에서 버튼을
 * 숨기는 것만으로는 이 API를 직접 호출하는 것을 막을 수 없기 때문에 서버가
 * 같은 조건을 다시 강제한다.
 */
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

  const { supabase } = auth;
  const { id: caseId } = await params;

  // 클라이언트가 보낸 case_id를 그대로 신뢰하지 않고, 관리자 세션의 RLS
  // 클라이언트로 실제 존재/연동 대상 여부를 먼저 확인한다.
  const { data: caseRow } = await supabase
    .from("cases")
    .select("case_id, source_type, legacy_sync_status, created_at")
    .eq("case_id", caseId)
    .maybeSingle();

  if (!caseRow) {
    return NextResponse.json({ error: "사례를 찾을 수 없습니다." }, { status: 404 });
  }

  if (caseRow.legacy_sync_status === null) {
    return NextResponse.json(
      { error: "기존 시스템 연동 대상이 아닌 사례입니다." },
      { status: 400 }
    );
  }

  // 'failed'는 기존과 동일하게 항상 허용한다. 'pending'은 최초 등록의
  // after() 전송이 아직 진행 중일 수 있으므로, 정상 처리라면 이미 끝났을
  // 시간이 지난 건에 대해서만 허용한다(기준과 근거는 lib/
  // legacy-sync-pending.ts) — 같은 사례에 전송이 동시에 두 번 일어나는
  // 것을 막기 위한 조건이다. 'synced'는 재전송 대상이 아니다.
  if (!canRetryLegacySync(caseRow.legacy_sync_status, caseRow.created_at)) {
    if (caseRow.legacy_sync_status === "pending") {
      return NextResponse.json(
        { error: "전송이 진행 중입니다. 잠시 후 상태를 다시 확인해주세요." },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "재전송할 수 있는 상태가 아닙니다." },
      { status: 400 }
    );
  }

  const result = await syncCaseToLegacySystem(caseRow.case_id);

  if (!result.ok) {
    return NextResponse.json(
      { error: "기존 시스템 재전송에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
