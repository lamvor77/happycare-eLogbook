import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminApi } from "@/lib/admin-auth";

function makeQrToken() {
  return Math.random().toString(36).slice(2, 12).toUpperCase();
}

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
  const { id } = await params;

  const qrToken = makeQrToken();

  const { error } = await supabase
    .from("hospitals")
    .update({ qr_token: qrToken })
    .eq("hospital_id", id);

  if (error) {
    console.error("QR 재발급 실패:", error);
    return NextResponse.json({ error: "QR 재발급에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, qr_token: qrToken });
}
