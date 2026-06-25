import PhotoList from "./PhotoList";
import { supabase } from "@/lib/supabase";

export default async function PatientCareLogsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data, error } = await supabase
    .from("care_logs")
    .select(`
      *,
      care_log_photos (*)
    `)
    .eq("patient_id", id)
    .order("created_at", { ascending: false });

  if (error) {
    return <main className="p-8">오류: {error.message}</main>;
  }

  return (
    <main className="p-8 bg-gray-50 min-h-screen">
      <h1 className="text-3xl font-bold mb-6">환자별 간병일지</h1>

      <div className="space-y-4">
        {data?.map((log) => (
          <div key={log.log_id} className="bg-white border rounded-lg p-5 shadow-sm">
            <div className="mb-3">
              <p className="font-bold text-lg">{log.care_date}</p>
              <p className="text-sm text-gray-500">
                작성시간:{" "}
                {log.created_at
                  ? new Date(log.created_at).toLocaleString("ko-KR")
                  : "-"}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4">
              <p>식사보조: {log.meal_assist ? "O" : "X"}</p>
              <p>이동보조: {log.move_assist ? "O" : "X"}</p>
              <p>배설보조: {log.toilet_assist ? "O" : "X"}</p>
              <p>위생관리: {log.hygiene_assist ? "O" : "X"}</p>
              <p>체위변경: {log.position_change ? "O" : "X"}</p>
              <p>위치확인: {log.location_status === "checked" ? "확인" : "미사용"}</p>
            </div>

            <div className="border-t pt-3 text-sm">
              <p>관계: {log.relationship || "-"}</p>
              <p>작성자/전자서명: {log.signature_name || "-"}</p>
              <p>특이사항: {log.memo || "-"}</p>
              {log.care_log_photos?.length > 0 && (
                <PhotoList photos={log.care_log_photos} />
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}