import { NextResponse } from "next/server";
import { toE164 } from "@/lib/phone";
import { sendOtp, OtpError } from "@/lib/otp";
import { isSameOriginRequest, sameOriginErrorResponse } from "@/lib/request-guard";
import {
  assertFamilyCodeJoinable,
  FamilyCodeCheckError,
  getClientKey,
} from "@/lib/family-code";

interface SendOtpBody {
  phone?: string;
  // 가족간병인 추가 화면만 보낸다. 값이 있으면 OTP를 만들기 전에 먼저
  // 검증한다 — 잘못된 코드로는 SMS도, OTP 레코드도 만들지 않는다.
  // 최초 등록/로그인 화면은 이 필드를 보내지 않으며 동작이 달라지지 않는다.
  family_code?: string;
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

  // 가족코드 검증을 먼저 통과해야 OTP 생성/발송 단계로 넘어간다. 화면이
  // 아니라 이 서버 라우트에서 막으므로, API를 직접 호출해도 잘못된
  // 가족코드로는 인증코드를 받을 수 없다.
  if (typeof body.family_code === "string") {
    try {
      await assertFamilyCodeJoinable(body.family_code, getClientKey(request));
    } catch (error) {
      if (error instanceof FamilyCodeCheckError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  }

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
