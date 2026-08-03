import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * 병원 QR 스캔(비로그인) 공개 조회 API. 로그인 없이도 호출 가능해야 하므로
 * anon 클라이언트를 쓰지만, 반환 컬럼을 최소한으로 제한해 개인정보 노출을
 * 막는다(hospital_code/hospital_phone 등은 반환하지 않음).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const code = searchParams.get("code");

  if (!token && !code) {
    return NextResponse.json(
      { error: "병원 식별 정보가 없습니다." },
      { status: 400 }
    );
  }

  let query = supabase
    .from("hospitals")
    .select("hospital_id, hospital_name, hospital_address, status")
    .eq("status", "active");

  query = token ? query.eq("qr_token", token) : query.eq("hospital_code", code as string);

  const { data, error } = await query.maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { error: "등록되지 않았거나 사용할 수 없는 병원입니다." },
      { status: 404 }
    );
  }

  return NextResponse.json({ hospital: data });
}
