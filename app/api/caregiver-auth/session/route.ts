import { NextResponse } from "next/server";
import { getCaregiverSession } from "@/lib/caregiver-auth";

/**
 * 현재 브라우저의 세션 쿠키가 유효한지 확인한다. case-register/case-join
 * 화면이 "이미 로그인되어 있으면 OTP 단계를 건너뛰기" 위해 사용한다.
 * 전화번호 등 민감 정보는 응답에 포함하지 않는다.
 */
export async function GET() {
  const session = await getCaregiverSession();

  if (!session) {
    return NextResponse.json({ loggedIn: false });
  }

  return NextResponse.json({
    loggedIn: true,
    caregiverName: session.caregiver.caregiver_name,
  });
}
