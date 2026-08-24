import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminApi } from "@/lib/admin-auth";
import { syncCaseToLegacySystem } from "@/lib/legacy-sync";

/**
 * 관리자 전용 "기존 시스템 연동 다시 전송"(작업 F). 실패한 사례에 대해서만
 * 관리자가 수동으로 재시도한다 — lib/legacy-sync.ts와 완전히 동일한 로직을
 * 재사용하고, 여기서는 새 전송 로직을 만들지 않는다.
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
    .select("case_id, source_type, legacy_sync_status")
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

  const result = await syncCaseToLegacySystem(caseRow.case_id);

  if (!result.ok) {
    return NextResponse.json(
      { error: "기존 시스템 재전송에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
