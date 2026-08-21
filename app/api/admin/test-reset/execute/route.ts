import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminApi } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  buildCountsSummary,
  collectLogIdsForCases,
  deleteStorageForLogIds,
  PREVIEW_MAX_AGE_MS,
  RESET_CONFIRMATION_TEXT,
  type TestResetCounts,
  type TestResetMode,
} from "@/lib/test-reset";

interface ExecuteRequestBody {
  preview_id?: string;
  mode?: TestResetMode;
  confirmation?: string;
  /** 휴대폰 기준 초기화에서 관리자가 체크한 사례들 */
  case_ids?: string[];
  delete_hospital?: boolean;
  revoke_sessions?: boolean;
}

interface ResetRpcRow {
  deleted_cases: number;
  deleted_case_caregivers: number;
  deleted_care_logs: number;
  deleted_care_log_photos: number;
  deleted_consents: number;
  deleted_histories: number;
  deleted_caregivers: number;
  deleted_sessions: number;
  deleted_otp_codes: number;
  deleted_hospitals: number;
}

function toCounts(row: ResetRpcRow): TestResetCounts {
  return {
    caregivers: row.deleted_caregivers,
    cases: row.deleted_cases,
    case_caregivers: row.deleted_case_caregivers,
    care_logs: row.deleted_care_logs,
    care_log_photos: row.deleted_care_log_photos,
    consents: row.deleted_consents,
    histories: row.deleted_histories,
    sessions: row.deleted_sessions,
    otp_codes: row.deleted_otp_codes,
  };
}

/**
 * 테스트 데이터 초기화 실행(하드 삭제). 아래를 모두 통과해야만 실행된다:
 *   1. requireAdminApi() — 관리자 인증
 *   2. 확인문구 "RESET" 정확히 일치
 *   3. 같은 관리자가 최근(10분 이내) 만든 Preview 기록 존재 + 대상 일치
 *   4. 그 Preview가 아직 소비되지 않음(같은 preview로 두 번 실행 불가)
 *   5. 클라이언트가 보낸 대상/건수는 신뢰하지 않고 서버에서 다시 조회
 * 삭제는 Storage(사진) → DB RPC(트랜잭션) 순서로 진행한다 — 파일 삭제가
 * 실패하면 DB는 건드리지 않고 중단한다.
 */
export async function POST(request: Request) {
  let auth;
  try {
    auth = await requireAdminApi();
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const { user, email } = auth;

  let body: ExecuteRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  if (body.confirmation !== RESET_CONFIRMATION_TEXT) {
    return NextResponse.json(
      { error: `확인문구 ${RESET_CONFIRMATION_TEXT}을(를) 정확히 입력해주세요.` },
      { status: 400 }
    );
  }

  if (!body.preview_id) {
    return NextResponse.json(
      { error: "삭제 대상 확인(Preview)을 먼저 실행해주세요." },
      { status: 400 }
    );
  }

  const mode = body.mode;

  if (mode !== "phone" && mode !== "case" && mode !== "hospital") {
    return NextResponse.json({ error: "초기화 기준이 올바르지 않습니다." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  const { data: preview } = await admin
    .from("admin_audit_logs")
    .select("audit_id, admin_user_id, action, target_type, target_id, target_case_ids, created_at")
    .eq("audit_id", body.preview_id)
    .maybeSingle();

  if (
    !preview ||
    preview.action !== "TEST_RESET_PREVIEW" ||
    preview.admin_user_id !== user.id ||
    preview.target_type !== mode ||
    !preview.target_id
  ) {
    return NextResponse.json(
      { error: "유효하지 않은 확인 정보입니다. 삭제 대상 확인을 다시 실행해주세요." },
      { status: 400 }
    );
  }

  if (Date.now() - new Date(preview.created_at).getTime() > PREVIEW_MAX_AGE_MS) {
    return NextResponse.json(
      { error: "확인 정보가 만료되었습니다. 삭제 대상 확인을 다시 실행해주세요." },
      { status: 400 }
    );
  }

  const { data: alreadyExecuted } = await admin
    .from("admin_audit_logs")
    .select("audit_id")
    .eq("related_preview_id", preview.audit_id)
    .maybeSingle();

  if (alreadyExecuted) {
    return NextResponse.json(
      { error: "이미 실행된 초기화입니다. 삭제 대상 확인을 다시 실행해주세요." },
      { status: 409 }
    );
  }

  const previewCaseIds: string[] = Array.isArray(preview.target_case_ids)
    ? (preview.target_case_ids as string[])
    : [];

  const revokeSessions = body.revoke_sessions !== false;

  // ---- 대상 사례/삭제할 사진(Storage) 계산: 항상 서버에서 다시 조회한다 ----
  let targetCaseIds: string[] = [];
  let logIdsForStorage: string[] = [];

  if (mode === "phone") {
    const requestedCaseIds = Array.isArray(body.case_ids) ? body.case_ids : [];

    if (requestedCaseIds.length === 0) {
      return NextResponse.json(
        { error: "초기화할 사례를 하나 이상 선택해주세요." },
        { status: 400 }
      );
    }

    const invalid = requestedCaseIds.filter((id) => !previewCaseIds.includes(id));

    if (invalid.length > 0) {
      return NextResponse.json(
        { error: "확인 단계에 없던 사례가 포함되어 있습니다. 다시 확인해주세요." },
        { status: 400 }
      );
    }

    // 이 caregiver와 실제로 연결된 사례만 남긴다(서버 재검증).
    const { data: links } = await admin
      .from("case_caregivers")
      .select("case_id")
      .eq("caregiver_id", preview.target_id)
      .in("case_id", requestedCaseIds);

    targetCaseIds = (links || []).map((row: { case_id: string }) => row.case_id);

    if (targetCaseIds.length === 0) {
      return NextResponse.json(
        { error: "선택한 사례가 이 간병인과 연결되어 있지 않습니다." },
        { status: 400 }
      );
    }

    // 사례에 다른 간병인이 남아 있으면 사례는 유지되고 이 간병인의 일지만
    // 지워진다 — 그 경우 Storage도 이 간병인의 일지 사진만 지운다.
    const { data: allLinks } = await admin
      .from("case_caregivers")
      .select("case_id")
      .in("case_id", targetCaseIds);

    const linkCountByCase = new Map<string, number>();
    for (const link of allLinks || []) {
      linkCountByCase.set(link.case_id, (linkCountByCase.get(link.case_id) || 0) + 1);
    }

    const fullDeleteCaseIds = targetCaseIds.filter(
      (id) => (linkCountByCase.get(id) || 0) <= 1
    );
    const partialCaseIds = targetCaseIds.filter(
      (id) => (linkCountByCase.get(id) || 0) > 1
    );

    logIdsForStorage = [
      ...(await collectLogIdsForCases(admin, fullDeleteCaseIds)),
      ...(await collectLogIdsForCases(admin, partialCaseIds, preview.target_id)),
    ];
  } else if (mode === "case") {
    targetCaseIds = [preview.target_id];
    logIdsForStorage = await collectLogIdsForCases(admin, targetCaseIds);
  } else {
    const { data: hospitalCases } = await admin
      .from("cases")
      .select("case_id")
      .eq("hospital_id", preview.target_id);

    targetCaseIds = (hospitalCases || []).map((row: { case_id: string }) => row.case_id);
    logIdsForStorage = await collectLogIdsForCases(admin, targetCaseIds);
  }

  // ---- 1) Storage 사진 삭제(트랜잭션에 포함할 수 없으므로 먼저 수행) ----
  // 실패하면 DB는 전혀 건드리지 않고 중단한다 — 데이터를 먼저 잃지 않는다.
  const storageResult = await deleteStorageForLogIds(admin, logIdsForStorage);

  if (storageResult.failedLogIds.length > 0) {
    console.error(
      "test-reset Storage 삭제 실패 — DB는 변경하지 않음. 실패 간병일지 수:",
      storageResult.failedLogIds.length
    );

    return NextResponse.json(
      {
        error:
          "사진 파일 삭제에 실패해 초기화를 중단했습니다(데이터는 변경되지 않았습니다). 잠시 후 다시 시도해주세요.",
      },
      { status: 500 }
    );
  }

  // ---- 2) DB 삭제(RPC 한 번 = 한 트랜잭션) ----
  let rpcName: string;
  let rpcArgs: Record<string, unknown>;

  if (mode === "phone") {
    rpcName = "reset_test_caregiver";
    rpcArgs = {
      p_caregiver_id: preview.target_id,
      p_case_ids: targetCaseIds,
      p_revoke_sessions: revokeSessions,
    };
  } else if (mode === "case") {
    rpcName = "reset_test_case";
    rpcArgs = {
      p_case_id: preview.target_id,
      p_revoke_sessions: revokeSessions,
    };
  } else {
    rpcName = "reset_test_hospital";
    rpcArgs = {
      p_hospital_id: preview.target_id,
      p_delete_hospital: body.delete_hospital === true,
      p_revoke_sessions: revokeSessions,
    };
  }

  const { data: rpcData, error: rpcError } = await admin.rpc(rpcName, rpcArgs);

  if (rpcError) {
    console.error(`${rpcName} 실패:`, rpcError.message);
    return NextResponse.json(
      { error: "초기화 처리에 실패했습니다." },
      { status: 500 }
    );
  }

  const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as ResetRpcRow | null;

  if (!row) {
    return NextResponse.json({ error: "초기화 처리에 실패했습니다." }, { status: 500 });
  }

  const counts = toCounts(row);

  // ---- 3) 감사 로그(건수만, PII 없음) ----
  const summary = `${buildCountsSummary(counts)}, 병원 ${row.deleted_hospitals}, Storage 파일 ${storageResult.removed}`;

  const { error: auditError } = await admin.from("admin_audit_logs").insert({
    admin_user_id: user.id,
    admin_email: email,
    action: "TEST_RESET",
    target_type: mode,
    target_id: preview.target_id,
    target_case_ids: targetCaseIds,
    summary,
    related_preview_id: preview.audit_id,
  });

  if (auditError) {
    console.error("test-reset 감사 로그 기록 실패:", auditError.message);
  }

  return NextResponse.json({
    ok: true,
    counts,
    deleted_hospitals: row.deleted_hospitals,
    removed_storage_files: storageResult.removed,
    summary,
  });
}
