import { requireAdmin } from "@/lib/admin-auth";

export default async function AdminHospitalsPage() {
  const { supabase } = await requireAdmin();

  const { data: hospitals, error } = await supabase
    .from("hospitals")
    .select(`
      *,
      cases (
        case_id,
        status,
        care_logs (
          care_date
        )
      )
    `)
    .order("created_at", { ascending: false });

  if (error) {
    return <main className="p-8">오류: {error.message}</main>;
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">병원관리</h1>

          <a
            href="/admin/hospitals/new"
            className="bg-blue-600 text-white px-4 py-2 rounded"
          >
            병원 등록
          </a>
        </div>

        <div className="space-y-4">
          {hospitals?.map((hospital: any) => {
            const cases = hospital.cases || [];
            const activeCases = cases.filter(
              (item: any) => item.status === "입원중"
            );

            const endedCases = cases.filter(
              (item: any) => item.status === "간병종료"
            );

            const todayWritten = activeCases.filter((item: any) =>
              item.care_logs?.some((log: any) => log.care_date === today)
            );

            const todayMissingCount =
              activeCases.length - todayWritten.length;

            return (
              <div
                key={hospital.hospital_id}
                className="bg-white border rounded-lg p-5 shadow-sm"
              >
                <p className="text-xl font-bold">
                  {hospital.hospital_name}
                </p>

                <p className="text-sm text-gray-600">
                  병원코드: {hospital.hospital_code || "-"}
                </p>

                <p className="text-sm text-gray-600">
                  주소: {hospital.hospital_address || "-"}
                </p>

                <p className="text-sm text-gray-600">
                  전화: {hospital.hospital_phone || "-"}
                </p>

                <p className="text-sm text-gray-600">
                  상태: {hospital.status || "active"}
                </p>

                <div className="grid grid-cols-4 gap-2 my-4 text-center text-sm">
                  <div className="border rounded p-2">
                    <p className="text-gray-500">입원중</p>
                    <p className="font-bold">{activeCases.length}</p>
                  </div>

                  <div className="border rounded p-2">
                    <p className="text-gray-500">간병종료</p>
                    <p className="font-bold">{endedCases.length}</p>
                  </div>

                  <div className="border rounded p-2">
                    <p className="text-gray-500">오늘작성</p>
                    <p className="font-bold">{todayWritten.length}</p>
                  </div>

                  <div className="border rounded p-2">
                    <p className="text-gray-500">미작성</p>
                    <p className="font-bold">{todayMissingCount}</p>
                  </div>
                </div>

                <div className="flex gap-2 mt-4">
                  <a
                    href={`/admin/hospitals/${hospital.hospital_id}/qr`}
                    className="bg-purple-600 text-white px-3 py-2 rounded text-sm"
                  >
                    QR 보기
                  </a>

                  <a
                    href={`/admin/hospitals/${hospital.hospital_id}/edit`}
                    className="bg-gray-700 text-white px-3 py-2 rounded text-sm"
                  >
                    수정
                  </a>

                  <a
                    href={`/admin/cases?hospital=${hospital.hospital_id}`}
                    className="bg-blue-600 text-white px-3 py-2 rounded text-sm"
                  >
                    사례 보기
                  </a>
                </div>
              </div>
            );
          })}

          {(!hospitals || hospitals.length === 0) && (
            <div className="bg-white border rounded-lg p-5 text-gray-500">
              등록된 병원이 없습니다.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}