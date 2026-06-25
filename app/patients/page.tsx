export default function OldPatientsPage() {
  return (
    <main className="min-h-screen bg-gray-50 p-4 flex items-center justify-center">
      <div className="max-w-md w-full bg-white rounded-lg shadow p-6 text-center">
        <h1 className="text-2xl font-bold mb-3">
          안내
        </h1>

        <p className="text-gray-600 mb-6">
          현재 시스템은 병원 공용 QR을 통해 이용합니다.
        </p>

        <p className="text-sm text-gray-500">
          병원 간호사 데스크에 비치된 QR을 스캔해 주세요.
        </p>
      </div>
    </main>
  );
}