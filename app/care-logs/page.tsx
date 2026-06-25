import { supabase } from "@/lib/supabase";

export default async function CareLogsPage() {
  const { data, error } = await supabase
    .from("care_logs")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return <main className="p-8">오류: {error.message}</main>;
  }

  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-6">간병일지 목록</h1>

      <div className="space-y-4">
        {data?.map((log) => (
          <div key={log.log_id} className="border rounded p-4">
            <p>간병일자: {log.care_date}</p>
            <p>식사보조: {log.meal_assist ? "O" : "X"}</p>
            <p>이동보조: {log.move_assist ? "O" : "X"}</p>
            <p>배설보조: {log.toilet_assist ? "O" : "X"}</p>
            <p>위생관리: {log.hygiene_assist ? "O" : "X"}</p>
            <p>체위변경: {log.position_change ? "O" : "X"}</p>
            <p>특이사항: {log.memo}</p>
            <p>전자서명: {log.signature_name}</p>
          </div>
        ))}
      </div>
    </main>
  );
}