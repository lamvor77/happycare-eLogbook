import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminApi } from "@/lib/admin-auth";

function makeQrToken() {
  return Math.random().toString(36).slice(2, 12).toUpperCase();
}

function makeHospitalCode() {
  return "HSP-" + Date.now().toString().slice(-6);
}

interface CreateHospitalBody {
  hospital_name?: string;
  hospital_address?: string;
  hospital_phone?: string;
}

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

  const { supabase } = auth;

  let body: CreateHospitalBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  if (!body.hospital_name || !body.hospital_name.trim()) {
    return NextResponse.json({ error: "병원명을 입력해주세요." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("hospitals")
    .insert({
      hospital_name: body.hospital_name.trim(),
      hospital_address: body.hospital_address || "",
      hospital_phone: body.hospital_phone || "",
      hospital_code: makeHospitalCode(),
      qr_token: makeQrToken(),
      status: "active",
    })
    .select()
    .single();

  if (error) {
    console.error("병원 등록 실패:", error);
    return NextResponse.json({ error: "병원 등록에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, hospital: data }, { status: 201 });
}
