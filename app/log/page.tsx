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
  // 최소 식별 정보만 조회한다. 환자 목록은 더 이상 이 화면에서 보여주지
  // 않는다(누구나 QR만 스캔하면 병원 내 전체 입원 환자명을 볼 수 있었던
  // 이전 구조의 개인정보 노출 문제를 제거하기 위함).
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

  const registerHref = q
    ? `/case-register?q=${q}`
    : `/case-register?h=${h}`;

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
        </div>

        <div className="bg-white rounded-lg shadow p-5 space-y-3">
          <p className="text-sm text-gray-600">
            이미 등록된 간병인이라면 로그인 후 본인의 사례만 확인할 수
            있습니다. 처음 방문하셨다면 최초 등록을 진행해주세요.
          </p>

          <a
            href="/caregiver-login"
            className="block text-center bg-gray-700 text-white p-4 rounded-lg font-bold"
          >
            간병인 로그인
          </a>

          <a
            href={registerHref}
            className="block text-center bg-blue-600 text-white p-4 rounded-lg font-bold"
          >
            간병인 &amp; 환자 최초 등록
          </a>
        </div>
      </div>
    </main>
  );
}
