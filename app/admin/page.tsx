import { supabase } from "@/lib/supabase";

function getSourceLabel(sourceType?: string) {
  if (sourceType === "google_form") return "구글폼";
  if (sourceType === "hospital_qr") return "병원QR";
  return "-";
}

export default async function AdminPage() {
  const { count: caseCount } = await supabase
    .from("cases")
    .select("*", { count: "exact", head: true });

  const { count: careLogCount } = await supabase
    .from("care_logs")
    .select("*", { count: "exact", head: true });

  const { count: caregiverCount } = await supabase
    .from("caregivers")
    .select("*", { count: "exact", head: true });

  const today = new Date().toISOString().slice(0, 10);

  const { count: todayCareLogCount } = await supabase
    .from("care_logs")
    .select("*", { count: "exact", head: true })
    .eq("care_date", today);

  const { count: checkedLocationCount } = await supabase
    .from("care_logs")
    .select("*", { count: "exact", head: true })
    .eq("location_status", "checked");

  const locationRate =
    careLogCount && careLogCount > 0
      ? Math.round(((checkedLocationCount || 0) / careLogCount) * 100)
      : 0;

  const { data: recentCases } = await supabase
    .from("cases")
    .select(`
      *,
      hospitals (
        hospital_name
      )
    `)
    .order("created_at", { ascending: false })
    .limit(10);

  const { data: recentLogs } = await supabase
    .from("care_logs")
    .select(`
      *,
      cases (
        patient_name,
        room_no
      )
    `)
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold">관리자 대시보드</h1>

        <a
          href="/admin/cases"
          className="inline-block bg-blue-600 text-white px-4 py-2 rounded"
        >
          전체 사례 목록 보기
        </a>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-white border rounded-lg p-5">
            <p className="text-gray-500">등록 사례</p>
            <p className="text-3xl font-bold">{caseCount || 0}</p>
          </div>

          <div className="bg-white border rounded-lg p-5">
            <p className="text-gray-500">간병일지</p>
            <p className="text-3xl font-bold">{careLogCount || 0}</p>
          </div>

          <div className="bg-white border rounded-lg p-5">
            <p className="text-gray-500">가족간병인</p>
            <p className="text-3xl font-bold">{caregiverCount || 0}</p>
          </div>

          <div className="bg-white border rounded-lg p-5">
            <p className="text-gray-500">오늘 작성</p>
            <p className="text-3xl font-bold">{todayCareLogCount || 0}</p>
          </div>

          <div className="bg-white border rounded-lg p-5">
            <p className="text-gray-500">위치확인률</p>
            <p className="text-3xl font-bold">{locationRate}%</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <section className="bg-white rounded-lg shadow p-5">
            <h2 className="text-xl font-bold mb-4">최근 등록 사례</h2>

            <div className="space-y-3">
              {recentCases?.map((item: any) => (
                <div key={item.case_id} className="border rounded p-3">
                  <a href={`/cases/${item.case_id}`} className="block">
                    <p className="font-bold">{item.patient_name}</p>
                    <p className="text-sm text-gray-600">
                      등록번호: {item.registration_no || "-"}
                    </p>
                    <p className="text-sm text-gray-600">
                      유입경로: {getSourceLabel(item.source_type)}
                    </p>
                    <p className="text-sm text-gray-600">
                      병원: {item.hospitals?.hospital_name || "-"}
                    </p>
                    <p className="text-sm text-gray-600">
                      호실: {item.room_no || "-"} / 상태: {item.status}
                    </p>
                  </a>

                  <a
                    href={`/admin/cases/${item.case_id}/print`}
                    className="inline-block mt-3 bg-purple-600 text-white px-3 py-2 rounded text-sm"
                  >
                    PDF 출력
                  </a>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-white rounded-lg shadow p-5">
            <h2 className="text-xl font-bold mb-4">최근 간병일지</h2>

            <div className="space-y-3">
              {recentLogs?.map((log: any) => (
                <div key={log.log_id} className="border rounded p-3">
                  <p className="font-bold">
                    {log.cases?.patient_name || "-"} /{" "}
                    {log.cases?.room_no || "-"}
                  </p>
                  <p className="text-sm">작성일: {log.care_date}</p>
                  <p className="text-sm">
                    작성자: {log.writer_name || log.signature_name || "-"}
                  </p>
                  <p className="text-sm">관계: {log.relationship || "-"}</p>
                  <p className="text-sm">
                    위치확인:{" "}
                    {log.location_status === "checked" ? "확인" : "미사용"}
                  </p>

                  <a
                    href={`/cases/${log.case_id}`}
                    className="inline-block mt-2 bg-blue-600 text-white px-3 py-2 rounded text-sm"
                  >
                    사례 보기
                  </a>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}