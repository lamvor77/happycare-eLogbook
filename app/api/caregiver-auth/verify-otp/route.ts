import { NextResponse } from "next/server";
import { toE164 } from "@/lib/phone";
import { verifyOtpCode, consumeVerifiedOtp, OtpError } from "@/lib/otp";
import { issueCaregiverSession } from "@/lib/caregiver-session";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isSameOriginRequest, sameOriginErrorResponse } from "@/lib/request-guard";

interface VerifyOtpBody {
  phone?: string;
  code?: string;
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return sameOriginErrorResponse();
  }

  let body: VerifyOtpBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  if (!body.phone || !body.code) {
    return NextResponse.json({ error: "인증코드를 입력해주세요." }, { status: 400 });
  }

  const phoneNormalized = toE164(body.phone);

  try {
    await verifyOtpCode(phoneNormalized, body.code.trim());
  } catch (error) {
    if (error instanceof OtpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("verify-otp 처리 중 오류:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "인증 처리에 실패했습니다." }, { status: 500 });
  }

  // 이미 등록된 간병인이면 이 자리에서 바로 장기 세션을 발급한다(재방문
  // 로그인 시나리오). 아직 caregiver가 없는 신규 등록/참여 흐름은 이후
  // /api/cases/register, /api/cases/join이 consumeVerifiedOtp()로 같은
  // 인증을 재사용하고, 성공 시 그때 세션을 발급한다.
  const supabase = createSupabaseAdminClient();

  const { data: caregiver } = await supabase
    .from("caregivers")
    .select("caregiver_id, caregiver_name")
    .eq("phone_normalized", phoneNormalized)
    .maybeSingle();

  if (caregiver) {
    await consumeVerifiedOtp(phoneNormalized);
    await issueCaregiverSession(caregiver.caregiver_id);

    return NextResponse.json({
      ok: true,
      caregiverExists: true,
      caregiverName: caregiver.caregiver_name,
    });
  }

  return NextResponse.json({ ok: true, caregiverExists: false });
}
