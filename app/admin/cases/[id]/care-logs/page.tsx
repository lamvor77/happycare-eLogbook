import { requireAdmin } from "@/lib/admin-auth";
import DeleteCareLogButton from "./DeleteCareLogButton";
import RestoreCareLogButton from "./RestoreCareLogButton";
import type { CareLog } from "@/types/domain";

export default async function AdminCaseCareLogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ includeDeleted?: string }>;
}) {
  const { supabase } = await requireAdmin();

  const { id } = await params;
  const { includeDeleted } = await searchParams;
  const showDeleted = includeDeleted === "1";

  const { data: caseData, error: caseError } = await supabase
    .from("cases")
    .select("case_id, case_no, patient_name")
    .eq("case_id", id)
    .maybeSingle();

  if (caseError || !caseData) {
    return <main className="p-8">사례 정보를 찾을 수 없습니다.</main>;
  }

  let logsQuery = supabase
    .from("care_logs")
    .select(`
      *,
      caregivers (
        caregiver_name,
        phone
      )
    `)
    .eq("case_id", id);

  if (!showDeleted) {
    logsQuery = logsQuery.is("deleted_at", null);
  }

  const { data: logs, error: logsError } = await logsQuery
    .order("care_date", { ascending: false })
    .order("created_at", { ascending: false });

  console.error(logsError);

  if (logsError) {
    console.error(
      "간병일지 조회 실패:",
      logsError.message,
      "code:",
      logsError.code,
      "details:",
      logsError.details,
      "hint:",
      logsError.hint
    );

    return <main className="p-8">간병일지 조회 중 오류가 발생했습니다.</main>;
  }

  // 필터 상태와 무관하게 활성/삭제/전체 건수는 항상 정확히 표시한다.
  const { count: activeCount } = await supabase
    .from("care_logs")
    .select("*", { count: "exact", head: true })
    .eq("case_id", id)
    .is("deleted_at", null);

  const { count: deletedCount } = await supabase
    .from("care_logs")
    .select("*", { count: "exact", head: true })
    .eq("case_id", id)
    .not("deleted_at", "is", null);

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="bg-white rounded-lg shadow p-5">
          <h1 className="text-2xl font-bold">간병일지 관리</h1>
          <p className="text-sm text-gray-700 mt-1">
            {caseData.patient_name} (사례번호: {caseData.case_no || "-"})
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div className="bg-white border rounded-lg p-3">
            <p className="text-gray-700">활성 일지</p>
            <p className="text-xl font-bold">{activeCount || 0}</p>
          </div>

          <div className="bg-white border rounded-lg p-3">
            <p className="text-gray-700">삭제된 일지</p>
            <p className="text-xl font-bold">{deletedCount || 0}</p>
          </div>

          <div className="bg-white border rounded-lg p-3">
            <p className="text-gray-700">전체</p>
            <p className="text-xl font-bold">
              {(activeCount || 0) + (deletedCount || 0)}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <a
            href={`/admin/cases/${id}/care-logs`}
            className={`px-3 py-2 rounded text-sm ${
              showDeleted ? "bg-gray-200 text-gray-800" : "bg-blue-600 text-white"
            }`}
          >
            활성 일지만
          </a>

          <a
            href={`/admin/cases/${id}/care-logs?includeDeleted=1`}
            className={`px-3 py-2 rounded text-sm ${
              showDeleted ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-800"
            }`}
          >
            삭제된 일지 포함
          </a>
        </div>

        <div className="space-y-3">
          {logs && logs.length > 0 ? (
            logs.map((log: CareLog) => {
              const isDeleted = Boolean(log.deleted_at);

              return (
                <div
                  key={log.log_id}
                  className={`bg-white border rounded-lg p-5 shadow-sm ${
                    isDeleted ? "opacity-70" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-lg">{log.care_date}</p>
                      <p className="text-sm text-gray-700">
                        작성자: {log.writer_name || log.signature_name || log.caregivers?.caregiver_name || "-"}
                        {log.relationship ? ` (${log.relationship})` : ""}
                      </p>
                      <p className="text-sm text-gray-700">
                        작성시간:{" "}
                        {log.created_at
                          ? new Date(log.created_at).toLocaleString("ko-KR")
                          : "-"}
                      </p>
                    </div>

                    {isDeleted ? (
                      <div className="shrink-0 flex flex-col items-end gap-2">
                        <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-1 rounded">
                          삭제됨
                        </span>
                        <RestoreCareLogButton logId={log.log_id} careDate={log.care_date} />
                      </div>
                    ) : (
                      <DeleteCareLogButton logId={log.log_id} careDate={log.care_date} />
                    )}
                  </div>

                  <div className="grid grid-cols-5 gap-2 text-sm mt-3">
                    <p>식사 {log.meal_assist ? "O" : "X"}</p>
                    <p>이동 {log.move_assist ? "O" : "X"}</p>
                    <p>배설 {log.toilet_assist ? "O" : "X"}</p>
                    <p>위생 {log.hygiene_assist ? "O" : "X"}</p>
                    <p>체위 {log.position_change ? "O" : "X"}</p>
                  </div>

                  {log.memo && (
                    <p className="text-sm text-gray-700 mt-2">특이사항: {log.memo}</p>
                  )}

                  {isDeleted && (
                    <div className="mt-3 border-t pt-2 text-sm text-red-700">
                      <p>
                        삭제일시:{" "}
                        {log.deleted_at
                          ? new Date(log.deleted_at).toLocaleString("ko-KR")
                          : "-"}
                      </p>
                      <p>삭제 사유: {log.delete_reason || "-"}</p>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="bg-white border rounded-lg p-5 text-gray-700 text-center">
              {showDeleted
                ? "작성된 간병일지가 없습니다."
                : "작성된 간병일지가 없습니다(삭제된 일지가 있다면 위 필터로 확인할 수 있습니다)."}
            </div>
          )}
        </div>

        <a
          href={`/admin/cases/${id}/print`}
          className="block text-center bg-purple-600 text-white px-4 py-3 rounded"
        >
          PDF 출력 화면으로
        </a>
      </div>
    </main>
  );
}
