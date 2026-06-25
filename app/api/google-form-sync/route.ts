import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
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

    const { data, error } = await supabase
      .from("cases")
      .upsert(
        {
          registration_no: registrationNo,
          source_type: "google_form",

          family_code: familyCode,

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
        },
        {
          onConflict: "registration_no",
        }
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      case_id: data.case_id,
      family_code: data.family_code,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}