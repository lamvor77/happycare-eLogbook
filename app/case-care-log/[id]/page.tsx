import { redirect } from "next/navigation";
import { CaregiverAuthError, requireCurrentCaregiverSession } from "@/lib/caregiver-auth";
import {
  canShowCurrentCaregiverChange,
  getCurrentCaregiverChangeCandidates,
} from "@/lib/case-caregivers";
import ChangeCurrentCaregiver from "@/app/cases/[id]/ChangeCurrentCaregiver";
import CareLogClient from "./CareLogClient";
import type { CaseCaregiver } from "@/types/domain";

export default async function CaseCareLogPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 간병일지 "작성" 화면이므로, 사례 데이터를 조회하기 전에 먼저
  // "이 caseId의 현재 간병인으로 로그인한 세션인지"를 서버에서 확인한다
  // (caseId URL만 안다고 다른 환자 사례를 볼 수 없어야 함). 클라이언트가
  // 보낸 caregiver_id는 사용하지 않고, 항상 세션 쿠키로 식별한다.
  let auth;

  try {
    auth = await requireCurrentCaregiverSession(id);
  } catch (authError) {
    if (!(authError instanceof CaregiverAuthError)) {
      throw authError;
    }

    if (authError.status === 401) {
      redirect(`/caregiver-login?next=${encodeURIComponent(`/case-care-log/${id}`)}`);
    }

    // 403(권한 없음)과 404(사례 없음), 400(간병종료)을 각각 다른 안내로
    // 보여주되, 어느 경우에도 환자 정보는 노출하지 않는다.
    return <main className="p-8">{authError.message}</main>;
  }

  const { supabase, caregiver, caseCaregiver } = auth;

  // caregivers(*)로 전체 컬럼을 가져오지 않는다 — 이 화면은
  // currentCaregiver.caregivers.caregiver_name만 쓴다. 주민등록번호
  // 원문/마스킹/암호화 컬럼을 매 요청마다 불필요하게 가져올 이유가 없다.
  const { data: caseData, error } = await supabase
    .from("cases")
    .select(
      `
      *,
      hospitals (*),
      case_caregivers (
        *,
        caregivers (caregiver_id, caregiver_name)
      )
    `
    )
    .eq("case_id", id)
    .maybeSingle();

  if (error) {
    return <main className="p-8">사례 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.</main>;
  }

  if (!caseData) {
    return <main className="p-8">사례 정보를 찾을 수 없습니다.</main>;
  }

  const currentCaregiver = caseData.case_caregivers?.find(
    (item: CaseCaregiver) => item.is_current_caregiver
  );

  if (!currentCaregiver) {
    return <main className="p-8">현재 간병인이 지정되어 있지 않습니다.</main>;
  }

  // 현재 간병인 변경 노출 조건은 사례 상세(app/cases/[id]/page.tsx)와
  // 같은 lib/case-caregivers.ts 규칙으로 판단한다 — 두 화면이 서로 다른
  // 기준을 갖지 않게 하기 위해서다. 컴포넌트도 사례 상세의 것을 그대로
  // 재사용한다(같은 기능을 복제하지 않는다).
  //
  // canManage에 true를 넘기는 근거: 위 requireCurrentCaregiverSession(id)를
  // 통과했다는 것은 (1) 로그인 상태이고 (2) 이 사례의 현재 간병인 본인이며
  // (3) 사례가 아직 진행 중(간병종료면 400으로 막힌다)이라는 뜻이다 —
  // 사례 상세가 canManage로 확인하는 조건과 같은 내용을 이 화면은 이미
  // 진입 시점에 강제하고 있다.
  const showCurrentCaregiverChange = canShowCurrentCaregiverChange(
    caseData.case_caregivers,
    true
  );

  // 위에서 requireCurrentCaregiverSession()을 통과했으므로 로그인 상태와
  // 현재 간병인 여부는 이미 서버에서 확정된 사실이다.
  const caregiverStatus = {
    loggedIn: true,
    isCurrent: true,
    caregiverName: caregiver.caregiver_name as string | null,
  };

  return (
    <CareLogClient
      caseId={id}
      patientName={caseData.patient_name}
      currentCaregiverName={currentCaregiver.caregivers?.caregiver_name ?? null}
      currentCaregiverRelationship={currentCaregiver.relationship ?? null}
      caregiverStatus={caregiverStatus}
      /*
       * 위치정보 동의는 (case_id, caregiver_id) 단위다 — 지금 로그인한
       * 간병인의 case_caregivers 행 값을 그대로 넘긴다. null이면 이 사례에서
       * 아직 한 번도 답하지 않은 것이므로 화면이 최초 질문을 띄운다.
       * 다른 간병인의 선택은 다른 행이라 여기 섞이지 않는다.
       */
      locationConsent={caseCaregiver.location_consent ?? null}
      currentCaregiverChange={
        showCurrentCaregiverChange ? (
          <ChangeCurrentCaregiver
            caseId={id}
            caregivers={getCurrentCaregiverChangeCandidates(
              caseData.case_caregivers
            )}
          />
        ) : null
      }
    />
  );
}
