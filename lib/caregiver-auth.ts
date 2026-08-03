import { createSupabaseServerClient } from "@/lib/supabase-server";

export class CaregiverAuthError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CaregiverAuthError";
    this.status = status;
  }
}

/**
 * 로그인 세션(Supabase Auth)과 caregivers.auth_user_id 연결 여부를 확인한다.
 * 로그인하지 않았거나 연결된 caregiver 행이 없으면 null을 반환한다(soft check).
 */
export async function getCaregiverSession() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: caregiver } = await supabase
    .from("caregivers")
    .select("*")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!caregiver) {
    return null;
  }

  return { supabase, user, caregiver };
}

/**
 * 로그인 + caregiver 연결을 강제한다. 조건 불충족 시 CaregiverAuthError를 던진다.
 * 페이지(Server Component)에서는 catch 후 redirect(), Route Handler에서는
 * catch 후 NextResponse.json으로 변환해서 사용한다.
 */
export async function requireCaregiver() {
  const session = await getCaregiverSession();

  if (!session) {
    throw new CaregiverAuthError("로그인이 필요합니다.", 401);
  }

  return session;
}

/**
 * caseId에 대해 로그인한 caregiver가 "현재 간병인(is_current_caregiver=true,
 * status=활성)"인지 서버에서 검증한다. 클라이언트가 보낸 값은 신뢰하지 않는다.
 */
export async function requireCurrentCaregiver(caseId: string) {
  const { supabase, user, caregiver } = await requireCaregiver();

  const { data: caseCaregiver } = await supabase
    .from("case_caregivers")
    .select("*")
    .eq("case_id", caseId)
    .eq("caregiver_id", caregiver.caregiver_id)
    .eq("is_current_caregiver", true)
    .eq("status", "활성")
    .maybeSingle();

  if (!caseCaregiver) {
    throw new CaregiverAuthError(
      "현재 간병인으로 등록된 경우에만 수행할 수 있습니다.",
      403
    );
  }

  return { supabase, user, caregiver, caseCaregiver };
}

/**
 * 화면 표시용 소프트 체크. 권한 판단의 근거로 쓰지 않고, UI 상태
 * (버튼 활성화, 안내 문구)를 결정하는 용도로만 사용한다.
 * 실제 저장/변경/종료는 항상 requireCurrentCaregiver()를 통해 서버에서 재검증한다.
 */
export async function getCurrentCaregiverStatus(caseId: string) {
  const session = await getCaregiverSession();

  if (!session) {
    return { loggedIn: false, isCurrent: false, caregiverName: null as string | null };
  }

  const { supabase, caregiver } = session;

  const { data: caseCaregiver } = await supabase
    .from("case_caregivers")
    .select("case_caregiver_id")
    .eq("case_id", caseId)
    .eq("caregiver_id", caregiver.caregiver_id)
    .eq("is_current_caregiver", true)
    .eq("status", "활성")
    .maybeSingle();

  return {
    loggedIn: true,
    isCurrent: Boolean(caseCaregiver),
    caregiverName: caregiver.caregiver_name as string | null,
  };
}
