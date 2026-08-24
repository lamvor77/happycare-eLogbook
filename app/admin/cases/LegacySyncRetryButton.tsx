"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 관리자 사례 목록의 "기존 시스템 연동: 실패" 상태에서만 노출되는 재시도
 * 버튼. lib/legacy-sync.ts를 다시 호출하는 기존 API(POST /api/admin/cases/
 * [id]/legacy-sync)만 호출하고, 새 전송 로직을 만들지 않는다.
 */
export default function LegacySyncRetryButton({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleRetry() {
    if (loading) return;

    setLoading(true);
    setMessage("");

    const response = await fetch(`/api/admin/cases/${caseId}/legacy-sync`, {
      method: "POST",
    });

    const body = await response.json().catch(() => null);

    setLoading(false);

    if (!response.ok) {
      setMessage(body?.error || "재전송에 실패했습니다.");
      return;
    }

    router.refresh();
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={handleRetry}
        disabled={loading}
        className="bg-red-600 text-white px-2 py-1 rounded text-xs font-bold disabled:opacity-50"
      >
        {loading ? "전송 중..." : "다시 전송"}
      </button>

      {message && <p className="text-xs text-red-600 mt-1">{message}</p>}
    </div>
  );
}
