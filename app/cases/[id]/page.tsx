import { redirect } from "next/navigation";
import { CaregiverAuthError, requireCaseMemberSession } from "@/lib/caregiver-auth";
import ChangeCurrentCaregiver from "./ChangeCurrentCaregiver";
import EndCareButton from "./EndCareButton";
import CaseHistory from "./CaseHistory";
import type { CaseCaregiver, CareLog } from "@/types/domain";

export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 사례 상세는 조회 화면이라 현재 간병인이 아닌 일반 가족간병인도 볼 수
  // 있어야 하지만, caseId URL만 안다고 아무나 볼 수는 없어야 한다. 그래서
  // "로그인 + 이 사례에 활성 상태로 연결된 caregiver인지"만 확인한다
  // (현재 간병인 여부는 여기서 요구하지 않는다 — 쓰기 기능은 각 버튼이
  // 호출하는 API가 requireCurrentCaregiverSession()으로 별도 검증한다).
  // 클라이언트가 보낸 caregiver_id는 신뢰하지 않고 세션 쿠키로만 식별한다.
  let auth;

  try {
    auth = await requireCaseMemberSession(id);
  } catch (authError) {
    if (!(authError instanceof CaregiverAuthError)) {
      throw authError;
    }

    if (authError.status === 401) {
      redirect(`/caregiver-login?next=${encodeURIComponent(`/cases/${id}`)}`);
    }

    // 403(권한 없음)과 404(사례 없음)를 각각 다른 안내로 보여주되, 어느
    // 경우에도 환자 정보는 노출하지 않는다.
    return <main className="p-8">{authError.message}</main>;
  }

  const { supabase, caseCaregiver } = auth;

  const { data: caseData, error: caseError } = await supabase
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
    .maybeSingle();

  if (caseError) {
    return <main className="p-8">사례 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.</main>;
  }

  if (!caseData) {
    return <main className="p-8">사례 정보를 찾을 수 없습니다.</main>;
  }

  const { data: careLogs } = await supabase
    .from("care_logs")
    .select("*")
    .eq("case_id", id)
    .order("care_date", { ascending: false });

  // CaseHistory는 이 페이지가 이미 통과한 requireCaseMemberSession() 권한
  // 검증과 service_role 클라이언트를 그대로 재사용한다 — 별도로 다시
  // 세션을 검증하지 않고, 이 조회도 항상 위 권한 확인 "이후"에만 실행된다.
  const { data: historyData, error: historyError } = await supabase
    .from("case_history")
    .select("history_id, case_id, history_type, title, action, description, actor, created_at")
    .eq("case_id", id)
    .order("created_at", { ascending: false });

  if (historyError) {
    console.error("case_history 조회 실패:", historyError.message);
  }

  const currentCaregiver = caseData.case_caregivers?.find(
    (item: CaseCaregiver) => item.is_current_caregiver
  );

  // requireCaseMemberSession()이 이미 확인한 caseCaregiver 정보로 계산한다
  // (별도 조회 없이) — 현재 간병인이면서 사례가 아직 "입원중"일 때만 현재
  // 간병인 변경/간병종료 같은 관리 기능을 노출한다.
  const memberCaseStatus = Array.isArray(caseCaregiver.cases)
    ? caseCaregiver.cases[0]?.status
    : caseCaregiver.cases?.status;
  const canManage = caseCaregiver.is_current_caregiver && memberCaseStatus === "입원중";

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto space-y-4">
        <div className="bg-white rounded-lg shadow p-5">
          <h1 className="text-2xl font-bold mb-2">
            {caseData.patient_name}
          </h1>

          <p className="text-sm text-gray-700 mb-4">
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
            <p className="text-xs text-gray-700">작성일수</p>
            <p className="text-xl font-bold">{careLogs?.length || 0}</p>
          </div>

          <div className="bg-white border rounded-lg p-3 text-center">
            <p className="text-xs text-gray-700">참여가족</p>
            <p className="text-xl font-bold">
              {caseData.case_caregivers?.length || 0}
            </p>
          </div>

          <div className="bg-white border rounded-lg p-3 text-center">
            <p className="text-xs text-gray-700">현재간병인</p>
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
            {caseData.case_caregivers?.map((item: CaseCaregiver) => (
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
          canChange={canManage}
        />

        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="font-bold mb-3">최근 간병일지</h2>

          <div className="space-y-3 text-sm">
            {careLogs?.slice(0, 3).map((log: CareLog) => (
              <div key={log.log_id} className="border rounded p-3">
                <p className="font-bold">{log.care_date}</p>
                <p>작성자: {log.writer_name || log.signature_name || "-"}</p>
                <p>관계: {log.relationship || "-"}</p>
                <p>특이사항: {log.memo || "-"}</p>
              </div>
            ))}

            {(!careLogs || careLogs.length === 0) && (
              <p className="text-gray-700">아직 작성된 간병일지가 없습니다.</p>
            )}
          </div>
        </div>

          <CaseHistory history={historyData} loadError={Boolean(historyError)} />

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

        <EndCareButton caseId={caseData.case_id} canEnd={canManage}
        />
      </div>
    </main>
  );
}