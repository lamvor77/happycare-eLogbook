import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminApi } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { toE164 } from "@/lib/phone";
import {
  buildCasePreview,
  buildCountsSummary,
  buildHospitalPreview,
  buildPhonePreview,
  type TestResetMode,
  type TestResetPreview,
} from "@/lib/test-reset";

interface PreviewRequestBody {
  mode?: TestResetMode;
  phone?: string;
  case_id?: string;
  hospital_id?: string;
}

/**
 * 테스트 데이터 초기화 Preview — 삭제 대상 건수만 계산하고 아무것도 지우지
 * 않는다. Preview 기록을 admin_audit_logs에 남기고 그 audit_id를
 * preview_id로 돌려주며, Execute는 이 preview_id 없이는 실행되지 않는다.
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

  let body: PreviewRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  const mode = body.mode;

  if (mode !== "phone" && mode !== "case" && mode !== "hospital") {
    return NextResponse.json({ error: "초기화 기준을 선택해주세요." }, { status: 400 });
  }

  // caregiver_sessions/caregiver_otp_codes는 anon/authenticated에 정책이
  // 전혀 없어(기본 거부) 관리자 세션 클라이언트로는 건수를 셀 수 없다.
  // 관리자 인증을 통과한 뒤에만 service_role 클라이언트를 만든다.
  const admin = createSupabaseAdminClient();

  let preview: TestResetPreview;

  if (mode === "phone") {
    if (!body.phone || !body.phone.trim()) {
      return NextResponse.json({ error: "휴대폰번호를 입력해주세요." }, { status: 400 });
    }

    preview = await buildPhonePreview(admin, toE164(body.phone));
  } else if (mode === "case") {
    if (!body.case_id) {
      return NextResponse.json({ error: "사례를 선택해주세요." }, { status: 400 });
    }

    preview = await buildCasePreview(admin, body.case_id);
  } else {
    if (!body.hospital_id) {
      return NextResponse.json({ error: "병원을 선택해주세요." }, { status: 400 });
    }

    preview = await buildHospitalPreview(admin, body.hospital_id);
  }

  if (!preview.found || !preview.target_id) {
    return NextResponse.json({
      ok: true,
      found: false,
      mode,
      preview_id: null,
      target_label: preview.target_label,
      counts: preview.counts,
      cases: [],
    });
  }

  const { data: auditRow, error: auditError } = await admin
    .from("admin_audit_logs")
    .insert({
      admin_user_id: user.id,
      admin_email: email,
      action: "TEST_RESET_PREVIEW",
      target_type: mode,
      target_id: preview.target_id,
      target_case_ids: preview.cases.map((item) => item.case_id),
      summary: buildCountsSummary(preview.counts),
    })
    .select("audit_id")
    .single();

  if (auditError || !auditRow) {
    console.error("test-reset preview 감사 로그 기록 실패:", auditError?.message);
    return NextResponse.json(
      { error: "초기화 대상 확인에 실패했습니다." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    found: true,
    mode,
    preview_id: auditRow.audit_id,
    target_label: preview.target_label,
    counts: preview.counts,
    cases: preview.cases,
  });
}
