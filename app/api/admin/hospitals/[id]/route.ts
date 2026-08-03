import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminApi } from "@/lib/admin-auth";

interface UpdateHospitalBody {
  hospital_name?: string;
  hospital_address?: string;
  hospital_phone?: string;
  status?: string;
}

export async function GET(
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

  const { data, error } = await supabase
    .from("hospitals")
    .select("*")
    .eq("hospital_id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "병원 정보를 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ hospital: data });
}

export async function PATCH(
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

  let body: UpdateHospitalBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  if (!body.hospital_name || !body.hospital_name.trim()) {
    return NextResponse.json({ error: "병원명을 입력해주세요." }, { status: 400 });
  }

  const { error } = await supabase
    .from("hospitals")
    .update({
      hospital_name: body.hospital_name.trim(),
      hospital_address: body.hospital_address || "",
      hospital_phone: body.hospital_phone || "",
      status: body.status === "inactive" ? "inactive" : "active",
    })
    .eq("hospital_id", id);

  if (error) {
    console.error("병원 수정 실패:", error);
    return NextResponse.json({ error: "저장에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
