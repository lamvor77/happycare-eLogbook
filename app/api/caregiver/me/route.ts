import { NextResponse } from "next/server";
import { getCaregiverSession } from "@/lib/caregiver-auth";

export async function GET() {
  const session = await getCaregiverSession();

  if (!session) {
    return NextResponse.json({ caregiver: null }, { status: 404 });
  }

  return NextResponse.json({
    caregiver: {
      caregiver_id: session.caregiver.caregiver_id,
      caregiver_name: session.caregiver.caregiver_name,
    },
  });
}
