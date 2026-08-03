import { supabase } from "@/lib/supabase";
import ChangeCurrentCaregiver from "./ChangeCurrentCaregiver";
import EndCareButton from "./EndCareButton";
import CaseHistory from "./CaseHistory";

export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: caseData } = await supabase
    .from("cases")
    .select(`
      *,
      hospitals (
        hospital_name,
        hospital_address
      ),
      case_caregivers (
        case_caregiver_id,
        relationship,
        is_primary_caregiver,
        is_current_caregiver,
        status,
        caregivers (
          caregiver_id,
          caregiver_name,
          phone
        )
      )
    `)
    .eq("case_id", id)
    .single();

  const { data: careLogs } = await supabase
    .from("care_logs")
    .select("*")
    .eq("case_id", id)
    .order("care_date", { ascending: false });

  if (!caseData) {
    return <main className="p-8">사례 정보를 찾을 수 없습니다.</main>;
  }

  const currentCaregiver = caseData.case_caregivers?.find(
    (item: any) => item.is_current_caregiver
  );

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto space-y-4">
        <div className="bg-white rounded-lg shadow p-5">
          <h1 className="text-2xl font-bold mb-2">
            {caseData.patient_name}
          </h1>

          <p className="text-sm text-gray-500 mb-4">
            상태: {caseData.status}
          </p>

          <div className="space-y-2 text-sm">
            <p>사례번호: {caseData.case_no || "-"}</p>
            <p>병원: {caseData.hospitals?.hospital_name || "-"}</p>
            <p>병원주소: {caseData.hospitals?.hospital_address || "-"}</p>
            <p>입원호실: {caseData.room_no || "-"}</p>
            <p>가족코드: {caseData.family_code}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white border rounded-lg p-3 text-center">
            <p className="text-xs text-gray-500">작성일수</p>
            <p className="text-xl font-bold">{careLogs?.length || 0}</p>
          </div>

          <div className="bg-white border rounded-lg p-3 text-center">
            <p className="text-xs text-gray-500">참여가족</p>
            <p className="text-xl font-bold">
              {caseData.case_caregivers?.length || 0}
            </p>
          </div>

          <div className="bg-white border rounded-lg p-3 text-center">
            <p className="text-xs text-gray-500">현재간병인</p>
            <p className="font-bold text-sm">
              {currentCaregiver?.caregivers?.caregiver_name || "-"}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="font-bold mb-3">환자 정보</h2>
          <div className="space-y-2 text-sm">
            <p>생년월일: {caseData.patient_birth_date || "-"}</p>
            <p>성별: {caseData.patient_gender || "-"}</p>
            <p>연락처: {caseData.patient_phone || "-"}</p>
            <p>진단명: {caseData.diagnosis_name || "-"}</p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="font-bold mb-3">보험/설계사 정보</h2>
          <div className="space-y-2 text-sm">
            <p>보험사: {caseData.insurance_company || "-"}</p>
            <p>사고유형: {caseData.accident_type || "-"}</p>
            <p>기타 사고유형: {caseData.accident_type_etc || "-"}</p>
            <p>담당설계사: {caseData.planner_name || "-"}</p>
            <p>설계사 연락처: {caseData.planner_phone || "-"}</p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="font-bold mb-3">가족간병인 목록</h2>

          <div className="space-y-3">
            {caseData.case_caregivers?.map((item: any) => (
              <div
                key={item.case_caregiver_id}
                className="border rounded p-3 text-sm"
              >
                <p className="font-bold">
                  {item.caregivers?.caregiver_name || "-"} ({item.relationship})
                </p>
                <p>연락처: {item.caregivers?.phone || "-"}</p>
                <p>현재 간병인: {item.is_current_caregiver ? "예" : "아니오"}</p>
                <p>주간병인: {item.is_primary_caregiver ? "예" : "아니오"}</p>
                <p>상태: {item.status || "-"}</p>
              </div>
            ))}
          </div>
        </div>

        <ChangeCurrentCaregiver
          caseId={caseData.case_id}
          caregivers={caseData.case_caregivers || []}
        />

        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="font-bold mb-3">최근 간병일지</h2>

          <div className="space-y-3 text-sm">
            {careLogs?.slice(0, 3).map((log: any) => (
              <div key={log.log_id} className="border rounded p-3">
                <p className="font-bold">{log.care_date}</p>
                <p>작성자: {log.writer_name || log.signature_name || "-"}</p>
                <p>관계: {log.relationship || "-"}</p>
                <p>특이사항: {log.memo || "-"}</p>
              </div>
            ))}

            {(!careLogs || careLogs.length === 0) && (
              <p className="text-gray-500">아직 작성된 간병일지가 없습니다.</p>
            )}
          </div>
        </div>

          <CaseHistory caseId={caseData.case_id} /> 

        <div className="grid grid-cols-1 gap-2">
        <a
            href={`/case-care-log/${caseData.case_id}`}
            className="text-center bg-blue-600 text-white px-4 py-3 rounded"
        >
            간병일지 작성
        </a>

        <a
            href={`/cases/${caseData.case_id}/care-logs`}
            className="text-center bg-gray-700 text-white px-4 py-3 rounded"
        >
            작성기록 보기
        </a>

        <a
            href={`/case-join?code=${caseData.family_code}`}
            className="text-center bg-green-600 text-white px-4 py-3 rounded"
        >
            가족간병인 추가
        </a>
        </div>

        <EndCareButton caseId={caseData.case_id}
        />
      </div>
    </main>
  );
}