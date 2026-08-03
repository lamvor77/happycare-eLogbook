import { supabase } from "@/lib/supabase";
import { getCurrentCaregiverStatus } from "@/lib/caregiver-auth";
import CareLogClient from "./CareLogClient";

export default async function CaseCareLogPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: caseData, error } = await supabase
    .from("cases")
    .select(
      `
      *,
      hospitals (*),
      case_caregivers (
        *,
        caregivers (*)
      )
    `
    )
    .eq("case_id", id)
    .single();

  if (error || !caseData) {
    return <main className="p-8">사례 정보를 찾을 수 없습니다.</main>;
  }

  const currentCaregiver = caseData.case_caregivers?.find(
    (item: any) => item.is_current_caregiver
  );

  if (!currentCaregiver) {
    return <main className="p-8">현재 간병인이 지정되어 있지 않습니다.</main>;
  }

  const caregiverStatus = await getCurrentCaregiverStatus(id);

  return (
    <CareLogClient
      caseId={id}
      patientName={caseData.patient_name}
      currentCaregiverName={currentCaregiver.caregivers?.caregiver_name ?? null}
      currentCaregiverRelationship={currentCaregiver.relationship ?? null}
      caregiverStatus={caregiverStatus}
    />
  );
}
