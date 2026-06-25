import { supabase } from "@/lib/supabase";


export default async function CaseCareLogsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: caseData } = await supabase
    .from("cases")
    .select("patient_name")
    .eq("case_id", id)
    .single();

  const { data: logs, error } = await supabase
    .from("care_logs")
    .select(`
      *,
      caregivers (
        caregiver_name,
        phone
      )
    `)
    .eq("case_id", id)
    .order("care_date", { ascending: false });

  if (error) {
    return <main className="p-8">오류: {error.message}</main>;
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto space-y-4">
        <div className="bg-white rounded-lg shadow p-5">
          <h1 className="text-2xl font-bold">통합 간병일지</h1>
          <p className="text-gray-600 mt-2">
            환자명: {caseData?.patient_name || "-"}
          </p>
        </div>

        {logs && logs.length > 0 ? (
          logs.map((log) => (
            <div
              key={log.log_id}
              className="bg-white border rounded-lg p-5 shadow-sm"
            >
              <div className="mb-3">
                <p className="font-bold text-lg">{log.care_date}</p>
                <p className="text-sm text-gray-500">
                  작성시간:{" "}
                  {log.created_at
                    ? new Date(log.created_at).toLocaleString("ko-KR")
                    : "-"}
                </p>
              </div>

              <div className="mb-3 text-sm">
                <p>
                  작성자: {log.writer_name || log.caregivers?.caregiver_name || "-"}
                </p>
                <p>관계: {log.relationship || "-"}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                <p>식사보조: {log.meal_assist ? "O" : "X"}</p>
                <p>이동보조: {log.move_assist ? "O" : "X"}</p>
                <p>배설보조: {log.toilet_assist ? "O" : "X"}</p>
                <p>위생관리: {log.hygiene_assist ? "O" : "X"}</p>
                <p>체위변경: {log.position_change ? "O" : "X"}</p>
                <p>
                  위치확인:{" "}
                  {log.location_status === "checked" ? "확인" : "미사용"}
                </p>
              </div>

              <div className="border-t pt-3 text-sm">
                <p>특이사항: {log.memo || "-"}</p>
              </div>
            </div>
          ))
        ) : (
          <div className="bg-white border rounded-lg p-5 text-gray-500">
            아직 작성된 간병일지가 없습니다.
          </div>
        )}
      </div>
    </main>
  );
}