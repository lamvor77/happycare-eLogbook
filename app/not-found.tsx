import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-gray-50 p-4 flex items-center justify-center">
      <div className="max-w-md w-full bg-white rounded-lg shadow p-6 text-center">
        <h1 className="text-2xl font-bold mb-3">페이지를 찾을 수 없습니다</h1>

        <p className="text-gray-600 mb-6">
          요청하신 페이지가 존재하지 않거나 이동되었습니다.
        </p>

        <Link
          href="/"
          className="inline-block bg-blue-600 text-white px-4 py-3 rounded-lg font-bold"
        >
          홈으로 이동
        </Link>
      </div>
    </main>
  );
}
