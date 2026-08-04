import { NextResponse } from "next/server";
import { toE164 } from "@/lib/phone";
import { sendOtp, OtpError } from "@/lib/otp";
import { isSameOriginRequest, sameOriginErrorResponse } from "@/lib/request-guard";

interface SendOtpBody {
  phone?: string;
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return sameOriginErrorResponse();
  }

  let body: SendOtpBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  if (!body.phone || !body.phone.trim()) {
    return NextResponse.json({ error: "휴대폰번호를 입력해주세요." }, { status: 400 });
  }

  const phoneNormalized = toE164(body.phone);

  try {
    await sendOtp(phoneNormalized);
  } catch (error) {
    if (error instanceof OtpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("send-otp 처리 중 오류:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "인증코드 발송에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
