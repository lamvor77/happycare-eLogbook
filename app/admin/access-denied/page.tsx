export default function AdminAccessDeniedPage() {
  return (
    <main className="min-h-screen bg-gray-50 p-4 flex items-center justify-center">
      <div className="max-w-md w-full bg-white rounded-lg shadow p-6 text-center">
        <h1 className="text-2xl font-bold mb-3">접근 권한이 없습니다</h1>

        <p className="text-gray-600 mb-6">
          로그인은 되었지만 이 계정은 관리자로 등록되어 있지 않습니다.
          관리자 권한이 필요하면 시스템 관리자에게 문의해주세요.
        </p>

        <a
          href="/"
          className="inline-block bg-blue-600 text-white px-4 py-3 rounded-lg font-bold"
        >
          홈으로 이동
        </a>
      </div>
    </main>
  );
}
