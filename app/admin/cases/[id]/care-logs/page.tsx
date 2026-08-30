import { requireAdmin } from "@/lib/admin-auth";
import DeleteCareLogButton from "./DeleteCareLogButton";
import RestoreCareLogButton from "./RestoreCareLogButton";
import type { CareLog } from "@/types/domain";
import { CARE_LOG_PHOTO_BUCKET } from "@/lib/care-log-photo";
import { formatKstDateTime } from "@/lib/kst";

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

  // care_logs.caregiver_id는 DB에 caregivers를 향한 FK가 없어 PostgREST가
  // 관계를 추론하지 못한다(PGRST200). caregivers를 중첩 select하지 않고
  // care_logs만 조회한다 — 작성자 이름은 작성 시점에 이미 이 행 자체의
  // writer_name/signature_name에 저장되어 있으므로 별도 조회도 필요 없다.
  let logsQuery = supabase.from("care_logs").select("*").eq("case_id", id);

  if (!showDeleted) {
    logsQuery = logsQuery.is("deleted_at", null);
  }

  const { data: logs, error: logsError } = await logsQuery
    .order("care_date", { ascending: false })
    .order("created_at", { ascending: false });

  console.error(logsError);

  // 첨부 사진. private 버킷이라 화면을 그릴 때마다 짧은 signed URL을 발급한다.
  const photoUrlByLogId = new Map<string, string>();
  const logIds = (logs || []).map((log: { log_id: string }) => log.log_id);

  if (logIds.length > 0) {
    const { data: photos } = await supabase
      .from("care_log_photos")
      .select("log_id, file_url")
      .in("log_id", logIds);

    for (const photo of photos || []) {
      if (!photo.file_url) continue;

      const { data: signed } = await supabase.storage
        .from(CARE_LOG_PHOTO_BUCKET)
        .createSignedUrl(photo.file_url, 60 * 30);

      if (signed?.signedUrl) {
        photoUrlByLogId.set(photo.log_id, signed.signedUrl);
      }
    }
  }

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
                        작성자: {log.writer_name || log.signature_name || "-"}
                        {log.relationship ? ` (${log.relationship})` : ""}
                      </p>
                      <p className="text-sm text-gray-700">
                        작성시간:{" "}
                        {formatKstDateTime(log.created_at)}
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

                  {photoUrlByLogId.has(log.log_id) && (
                    <div className="mt-3 border-t pt-2">
                      <p className="text-sm text-gray-700 mb-2">첨부 사진</p>

                      {/* Supabase signed URL이라 next/image 최적화 대상이 아니다. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photoUrlByLogId.get(log.log_id)}
                        alt="간병일지 첨부 사진"
                        className="w-full max-h-72 object-contain rounded border"
                      />
                    </div>
                  )}

                  {isDeleted && (
                    <div className="mt-3 border-t pt-2 text-sm text-red-700">
                      <p>
                        삭제일시:{" "}
                        {formatKstDateTime(log.deleted_at)}
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
