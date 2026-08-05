import { supabase } from "@/lib/supabase";

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<{ h?: string; q?: string }>;
}) {
  const { h, q } = await searchParams;

  if (!h && !q) {
    return <main className="p-8">병원 QR 정보가 없습니다.</main>;
  }

  // 개인정보 최소화: 이 화면은 로그인 없이 접근 가능하므로 병원의
  // 최소 식별 정보만 조회한다. 환자 목록은 이 화면에서 보여주지 않는다.
  let query = supabase
    .from("hospitals")
    .select("hospital_id, hospital_name, hospital_address, status");

  query = q ? query.eq("qr_token", q) : query.eq("hospital_code", h as string);

  const { data: hospital } = await query.maybeSingle();

  if (!hospital) {
    return <main className="p-8">등록되지 않은 병원입니다.</main>;
  }

  if (hospital.status !== "active") {
    return (
      <main className="p-8">
        계약이 종료되었거나 사용할 수 없는 병원입니다.
      </main>
    );
  }

  const hospitalQuery = q ? `q=${q}` : `h=${h}`;
  const registerHref = `/case-register?${hospitalQuery}`;

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

          <p className="text-sm text-gray-700 mt-1">
            {hospital.hospital_address || "-"}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-5 space-y-3">
          <p className="text-sm text-gray-600">
            아래 버튼을 눌러 진행해주세요. QR을 스캔했다고 해서 자동으로
            간병일지 화면으로 이동하지 않습니다.
          </p>

          <a
            href="/my-cases"
            className="block text-center bg-blue-600 text-white p-4 rounded-lg font-bold"
          >
            간병일지 작성
          </a>

          <a
            href={registerHref}
            className="block text-center bg-gray-700 text-white p-4 rounded-lg font-bold"
          >
            간병인 &amp; 환자 최초 등록
          </a>

          <a
            href="/case-join"
            className="block text-center bg-green-600 text-white p-4 rounded-lg font-bold"
          >
            가족간병인 추가
          </a>
        </div>
      </div>
    </main>
  );
}
