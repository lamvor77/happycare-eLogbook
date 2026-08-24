import { NextResponse } from "next/server";
import { fetchLegacyRegistrationOptions } from "@/lib/legacy-registration-options";

/**
 * QR 최초 등록 화면(app/case-register)이 보험사/사고유형 선택지를 받는
 * 공개 엔드포인트. 인증 없음(등록 화면 자체가 OTP 인증 이전에도 보여야
 * 하는 화면이라 병원 QR 조회(GET /api/hospitals/lookup)와 같은 신뢰
 * 모델을 쓴다). 민감정보를 전혀 포함하지 않는다.
 *
 * 브라우저는 이 라우트만 호출한다 — 기존 시스템의 실제 URL/시크릿
 * (LEGACY_FAMILYCARE_CONFIG_URL/LEGACY_FAMILYCARE_WEBHOOK_SECRET)은
 * lib/legacy-registration-options.ts 안에서만 서버 전용으로 쓰인다.
 */
export async function GET() {
  const result = await fetchLegacyRegistrationOptions();

  return NextResponse.json({
    ok: result.ok,
    stale: result.stale,
    insuranceCompanies: result.insuranceCompanies,
    accidentTypes: result.accidentTypes,
  });
}
