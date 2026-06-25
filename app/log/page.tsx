import { supabase } from "@/lib/supabase";

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<{ h?: string }>;
}) {
  const { h } = await searchParams;

  if (!h) {
    return <main className="p-8">병원 QR 정보가 없습니다.</main>;
  }

  const { data: hospital } = await supabase
    .from("hospitals")
    .select("*")
    .eq("hospital_code", h)
    .single();

  if (!hospital) {
    return <main className="p-8">등록되지 않은 병원입니다.</main>;
  }

  const { data: cases } = await supabase
    .from("cases")
    .select("*")
    .eq("hospital_id", hospital.hospital_id)
    .eq("status", "입원중")
    .order("created_at", { ascending: false });

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto space-y-4">
        <div className="bg-white rounded-lg shadow p-6 mt-6">
          <h1 className="text-2xl font-bold mb-2">
            해피간병 전자간병일지
          </h1>

          <p className="text-gray-700 font-bold">
            {hospital.hospital_name}
          </p>

          <p className="text-sm text-gray-500 mt-1">
            {hospital.hospital_address || "-"}
          </p>

          <div className="border rounded p-3 mt-4 text-sm">
            <p>병원코드: {hospital.hospital_code}</p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="font-bold mb-3">등록된 환자</h2>

          {cases && cases.length > 0 ? (
            <div className="space-y-3">
              {cases.map((caseItem) => (
                <a
                  key={caseItem.case_id}
                  href={`/cases/${caseItem.case_id}`}
                  className="block border rounded p-3"
                >
                  <p className="font-bold">{caseItem.patient_name}</p>
                  <p className="text-sm text-gray-600">
                    입원호실: {caseItem.room_no || "-"}
                  </p>
                  <p className="text-sm text-gray-600">
                    상태: {caseItem.status}
                  </p>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              등록된 환자가 없습니다.
            </p>
          )}
        </div>

        <a
          href={`/case-register?h=${hospital.hospital_code}`}
          className="block text-center bg-blue-600 text-white p-4 rounded-lg font-bold"
        >
          간병인 & 환자 등록하기
        </a>
      </div>
    </main>
  );
}