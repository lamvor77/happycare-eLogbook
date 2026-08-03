import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { makeCaseNo } from "@/lib/case-no";

export async function POST(request: Request) {
  const serverSecret = process.env.GOOGLE_FORM_SYNC_SECRET;

  if (!serverSecret) {
    return NextResponse.json(
      { error: "서버 설정 오류입니다." },
      { status: 500 }
    );
  }

  const requestSecret = request.headers.get("x-happycare-sync-secret");

  if (!requestSecret || requestSecret !== serverSecret) {
    return NextResponse.json(
      { error: "인증에 실패했습니다." },
      { status: 401 }
    );
  }

  // 시크릿 검증을 통과한 요청만 service_role 클라이언트를 생성한다.
  // 이 클라이언트는 RLS를 우회하므로 이 라우트 밖으로 내보내거나
  // 브라우저 코드에서 import하지 않는다(lib/supabase-admin.ts의
  // "server-only" 가드 참고).
  let supabase;
  try {
    supabase = createSupabaseAdminClient();
  } catch (error: any) {
    console.error("supabase-admin 클라이언트 생성 실패:", error?.message);
    return NextResponse.json(
      { error: "서버 설정 오류입니다." },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();

    const registrationNo = body.registration_no;

    if (!registrationNo) {
      return NextResponse.json(
        { error: "registration_no가 없습니다." },
        { status: 400 }
      );
    }

    const familyCode = body.family_code || `FC-${Date.now()}`;

    const { data: existingByRegistration } = await supabase
      .from("cases")
      .select("case_id, family_code")
      .eq("registration_no", registrationNo)
      .maybeSingle();

    const payload = {
      case_no: body.case_no || makeCaseNo(),
      registration_no: registrationNo,
      source_type: "google_form",
      family_code: existingByRegistration?.family_code || familyCode,

      patient_name: body.patient_name,
      patient_birth_date: body.patient_birth_date || null,
      patient_phone: body.patient_phone,
      patient_gender: body.patient_gender,
      diagnosis_name: body.diagnosis_name,
      room_no: body.room_no,

      insurance_company: body.insurance_company,
      accident_type: body.accident_type,
      accident_type_etc: body.accident_type_etc,

      planner_name: body.planner_name,
      planner_phone: body.planner_phone,

      care_start_date: body.care_start_date || null,
      care_end_date: body.care_end_date || null,

      memo: body.memo,
      status: body.status || "입원중",
      privacy_agreed: true,
    };

    const { data, error } = await supabase
      .from("cases")
      .upsert(payload, {
        onConflict: "registration_no",
      })
      .select()
      .single();

    if (error) {
      console.error("google-form-sync upsert 실패:", error.message);
      return NextResponse.json(
        { error: "동기화 처리에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      case_id: data.case_id,
      case_no: data.case_no,
      family_code: data.family_code,
    });
  } catch (error: any) {
    console.error("google-form-sync 처리 중 오류:", error?.message);
    return NextResponse.json(
      { error: "동기화 처리에 실패했습니다." },
      { status: 500 }
    );
  }
}