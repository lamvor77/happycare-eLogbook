export default function HomePage() {
  return (
    <main className="min-h-screen bg-gray-50 p-4 flex items-center justify-center">
      <div className="max-w-md w-full bg-white rounded-lg shadow p-6 text-center">
        <h1 className="text-3xl font-bold mb-3">
          해피간병
        </h1>

        <p className="text-gray-600 mb-6">
          가족간병 전자간병일지 시스템
        </p>

        <div className="border rounded p-4 text-sm text-gray-700 mb-6 text-left">
          <p className="font-bold mb-2">이용 안내</p>
          <p>
            간병일지는 병원 간호사 데스크에 비치된 QR코드를
            스캔하여 작성합니다.
          </p>
          <p className="mt-2">
            환자정보는 QR에 저장되지 않으며, 병원 공용 QR은
            병원 확인 용도로만 사용됩니다.
          </p>
        </div>

        <p className="text-sm text-gray-500">
          병원 QR을 스캔해 주세요.
        </p>
      </div>
    </main>
  );
}