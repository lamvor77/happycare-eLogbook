import { NextResponse } from "next/server";
import { clearCaregiverSession } from "@/lib/caregiver-session";
import { isSameOriginRequest, sameOriginErrorResponse } from "@/lib/request-guard";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return sameOriginErrorResponse();
  }

  await clearCaregiverSession();

  return NextResponse.json({ ok: true });
}
