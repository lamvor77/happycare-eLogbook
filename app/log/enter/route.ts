import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { buildQrPassCookie } from "@/lib/qr-pass-cookie";
import { resolveQrEntryNext } from "@/lib/qr-entry-next";

/**
 * 병원 QR 진입 증표 발급.
 *
 *   GET /log/enter?q=<qr_token>&next=<허용된 경로>
 *
 * /log 화면(Server Component)은 쿠키를 심을 수 없으므로, 그 화면의 다음
 * 단계 버튼 3개(간병일지 작성 / 최초 등록 / 가족간병인 추가)가 이 라우트를
 * 거쳐 목적지로 간다. 사용자는 이 중간 단계를 보지 않는다 — 검증이 끝나면
 * 즉시 redirect다.
 *
 * 발급 조건: q가 있고, get_public_hospital_v2가 병원을 돌려주고, 그 병원이
 * active일 때. 셋 중 하나라도 아니면 쿠키 없이 /log로 돌려보낸다(그 화면이
 * "등록되지 않은 병원" 등 기존 안내를 그대로 보여준다).
 *
 * h(hospital_code)로는 발급하지 않는다. 병원코드는 관리자 화면에 표시되는
 * 값이라 "현장에 비치된 QR을 스캔했다"는 증거가 되지 못한다. /log?h= 조회
 * 자체는 그대로 유지된다 — 그 화면의 버튼이 이 라우트를 쓰지 않을 뿐이다.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  const next = url.searchParams.get("next");

  if (!q || !q.trim()) {
    return NextResponse.redirect(new URL("/log", url.origin));
  }

  // hospitals를 직접 읽지 않는다 — anon에는 qr_token 컬럼 권한이 없고,
  // 이 함수는 토큰을 아는 사람에게만 그 병원의 최소 정보를 준다
  // (app/log/page.tsx와 같은 조회).
  const { data: hospitals, error } = await supabase.rpc("get_public_hospital_v2", {
    p_qr_token: q,
    p_hospital_code: null,
  });

  const hospital = hospitals?.[0] ?? null;

  if (error || !hospital || hospital.status !== "active" || !hospital.hospital_id) {
    // 토큰 값은 로그에 남기지 않는다.
    return NextResponse.redirect(new URL(`/log?q=${encodeURIComponent(q)}`, url.origin));
  }

  const destination = resolveQrEntryNext(next, url.origin, q);

  if (!destination) {
    // 허용되지 않은 목적지. 증표 없이 /log로 돌려보낸다 — 정상 버튼을
    // 다시 누르면 된다.
    return NextResponse.redirect(new URL(`/log?q=${encodeURIComponent(q)}`, url.origin));
  }

  const cookie = buildQrPassCookie(hospital.hospital_id);
  const response = NextResponse.redirect(destination);
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
