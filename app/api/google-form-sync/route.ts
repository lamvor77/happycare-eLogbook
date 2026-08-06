import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { makeCaseNo } from "@/lib/case-no";
import { normalizePatientBirthDateParts, type BirthCentury } from "@/lib/registration-validation";

interface GoogleFormSyncBody {
  registration_no?: string;
  family_code?: string;
  case_no?: string;
  patient_name?: string;
  // 기존 구글폼은 이 값을 이미 파싱 가능한 날짜 문자열(예: "1950-01-01")로
  // 보낸다고 가정한다(그대로 upsert되어 왔고 실패 사례가 보고된 적 없음).
  // QR 등록과 동일하게 "6자리(YYMMDD)"로 보내는 경우에도 처리할 수 있도록
  // patient_birth_century를 함께 받으면 서버에서 변환한다(선택 — 기존
  // 방식과 100% 하위호환).
  patient_birth_date?: string;
  patient_birth_century?: BirthCentury;
  patient_phone?: string;
  patient_gender?: string;
  diagnosis_name?: string;
  room_no?: string;
  insurance_company?: string;
  accident_type?: string;
  accident_type_etc?: string;
  planner_name?: string;
  planner_phone?: string;
  care_start_date?: string;
  care_end_date?: string;
  memo?: string;
  status?: string;
}

/**
 * *** 간병인 주민등록번호 관련 확인 사항(작업 F) ***
 * 이 라우트는 caregivers/case_caregivers를 전혀 생성하지 않는다 — 현재
 * 구글폼은 간병인 이름/전화번호/주민등록번호를 이 엔드포인트로 전달하지
 * 않으며(GoogleFormSyncBody에 해당 필드가 없다), 이 코드도 그런 필드를
 * 받지 않는다. 즉 "구글폼이 간병인 주민등록번호 전체를 전달하는지" ->
 * 아니오(현재는 cases 테이블만 upsert한다). resident_number(원문) 컬럼에
 * 쓰는 로직도 없다.
 * 만약 향후 Apps Script가 간병인 정보를 함께 보내도록 바뀐다면, 이 자리에
 * 간단히 caregivers.insert를 추가하지 말 것 — register_case_v3처럼
 * caregiver/case_caregiver 생성이 원자적으로 묶여야 하고, 주민등록번호는
 * lib/caregiver-resident-number.ts로 암호화해서만 저장해야 한다. 새
 * RPC(register_case_v3에 준하는 google-form 전용 버전 또는 동일 RPC 재사용)를
 * 설계해서 별도 작업으로 진행할 것.
 */

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
  } catch (error: unknown) {
    console.error("supabase-admin 클라이언트 생성 실패:", getErrorMessage(error));
    return NextResponse.json(
      { error: "서버 설정 오류입니다." },
      { status: 500 }
    );
  }

  try {
    const body: GoogleFormSyncBody = await request.json();

    const registrationNo = body.registration_no;

    if (!registrationNo) {
      return NextResponse.json(
        { error: "registration_no가 없습니다." },
        { status: 400 }
      );
    }

    const familyCode = body.family_code || `FC-${Date.now()}`;

    // 환자 생년월일: QR 등록과 동일한 6자리(YYMMDD) 형식으로 오면 서버에서
    // 변환하고, 그렇지 않으면(기존 방식대로 이미 완전한 날짜 문자열이면)
    // 그대로 둔다 — 기존 연동을 깨지 않기 위한 하위호환 처리다.
    let patientBirthDate = body.patient_birth_date || null;

    if (patientBirthDate && /^\d{6}$/.test(patientBirthDate)) {
      if (!body.patient_birth_century) {
        return NextResponse.json(
          { error: "patient_birth_century가 필요합니다(YYMMDD 형식으로 보낼 경우)." },
          { status: 400 }
        );
      }

      const normalized = normalizePatientBirthDateParts(
        patientBirthDate,
        body.patient_birth_century
      );

      if (!normalized) {
        return NextResponse.json(
          { error: "patient_birth_date 형식을 확인해주세요." },
          { status: 400 }
        );
      }

      patientBirthDate = normalized;
    }

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
      patient_birth_date: patientBirthDate,
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
  } catch (error: unknown) {
    console.error("google-form-sync 처리 중 오류:", getErrorMessage(error));
    return NextResponse.json(
      { error: "동기화 처리에 실패했습니다." },
      { status: 500 }
    );
  }
}