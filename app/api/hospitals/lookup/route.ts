import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * 병원 QR 스캔(비로그인) 공개 조회 API. 로그인 없이도 호출 가능해야 하므로
 * anon 클라이언트를 쓰지만, 조회는 get_public_hospital_v2(SECURITY DEFINER)를
 * 거친다 — 그 함수가 qr_token/hospital_code/hospital_phone을 반환하지 않아
 * 응답에도, anon의 테이블 권한에도 남지 않는다.
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

  // hospitals를 직접 조회하지 않고 SECURITY DEFINER 함수를 쓴다 — 테이블을
  // qr_token으로 거르려면 anon에게 그 컬럼 SELECT 권한이 필요한데, 그러면
  // anon 키로 활성 병원 전체의 QR 토큰을 열거할 수 있다.
  const { data: rows, error } = await supabase.rpc("get_public_hospital_v2", {
    p_qr_token: token,
    p_hospital_code: token ? null : code,
  });

  const data = rows?.[0] ?? null;

  if (error || !data || data.status !== "active") {
    return NextResponse.json(
      { error: "등록되지 않았거나 사용할 수 없는 병원입니다." },
      { status: 404 }
    );
  }

  return NextResponse.json({ hospital: data });
}
