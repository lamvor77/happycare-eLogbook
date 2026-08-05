"use client";

import { useState } from "react";

export default function DeleteCareLogButton({
  logId,
  careDate,
}: {
  logId: string;
  careDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function handleConfirmDelete() {
    if (!reason.trim()) {
      setMessage("삭제 사유를 입력해주세요.");
      return;
    }

    setSaving(true);
    setMessage("");

    const response = await fetch(`/api/admin/care-logs/${logId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() }),
    });

    const body = await response.json().catch(() => null);

    setSaving(false);

    if (!response.ok) {
      setMessage(body?.error || "삭제에 실패했습니다.");
      return;
    }

    window.location.reload();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setReason("");
          setMessage("");
        }}
        className="shrink-0 bg-red-600 text-white text-sm px-3 py-2 rounded"
      >
        삭제
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow p-5 w-full max-w-sm">
            <h2 className="font-bold text-lg mb-2">간병일지 삭제</h2>

            <p className="text-sm text-gray-700 mb-4">
              {careDate} 간병일지를 삭제합니다. 이 작업은 목록에서만
              숨겨지며, 기록 자체와 삭제 사유는 사례 이력에 남습니다.
            </p>

            <label className="block text-sm font-bold text-gray-800 mb-1">
              삭제 사유 (필수)
            </label>

            <textarea
              className="w-full border p-3 rounded mb-3 text-gray-900"
              rows={3}
              placeholder="예: 중복 작성, 작성자 요청 등"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />

            {message && (
              <p className="text-sm text-red-600 mb-3">{message}</p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={saving}
                className="flex-1 bg-gray-200 text-gray-800 p-3 rounded disabled:opacity-50"
              >
                취소
              </button>

              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={saving}
                className="flex-1 bg-red-600 text-white p-3 rounded font-bold disabled:opacity-50"
              >
                {saving ? "삭제 중..." : "삭제 확인"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
