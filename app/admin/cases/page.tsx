import { supabase } from "@/lib/supabase";

function getSourceLabel(sourceType?: string) {
  if (sourceType === "google_form") return "구글폼";
  if (sourceType === "hospital_qr") return "병원QR";
  return "-";
}

export default async function AdminCasesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;

  let query = supabase
    .from("cases")
    .select(`
      *,
      hospitals (
        hospital_name
      )
    `)
    .order("created_at", { ascending: false });

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data: cases, error } = await query;

  if (error) {
    return <main className="p-8">오류: {error.message}</main>;
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-5xl mx-auto space-y-4">
        <h1 className="text-3xl font-bold">전체 사례 목록</h1>

        <div className="flex gap-2">
          <a href="/admin/cases?status=all" className="bg-gray-700 text-white px-3 py-2 rounded">
            전체
          </a>

          <a href="/admin/cases?status=입원중" className="bg-blue-600 text-white px-3 py-2 rounded">
            입원중
          </a>

          <a href="/admin/cases?status=간병종료" className="bg-red-600 text-white px-3 py-2 rounded">
            간병종료
          </a>
        </div>

        {cases?.map((item: any) => (
          <div key={item.case_id} className="bg-white border rounded-lg p-5 shadow-sm">
            <p className="font-bold text-lg">{item.patient_name}</p>

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
              호실: {item.room_no || "-"}
            </p>

            <p className="text-sm text-gray-600">
              상태: {item.status}
            </p>

            <div className="flex gap-2 mt-3">
              <a
                href={`/cases/${item.case_id}`}
                className="bg-blue-600 text-white px-3 py-2 rounded text-sm"
              >
                사례 보기
              </a>

              <a
                href={`/admin/cases/${item.case_id}/print`}
                className="bg-purple-600 text-white px-3 py-2 rounded text-sm"
              >
                PDF 출력
              </a>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}