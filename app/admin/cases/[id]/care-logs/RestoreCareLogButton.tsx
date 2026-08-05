"use client";

import { useState } from "react";

const REASON_MIN_LENGTH = 5;
const REASON_MAX_LENGTH = 500;

export default function RestoreCareLogButton({
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

  async function handleConfirmRestore() {
    if (saving) return;

    const trimmed = reason.trim();

    if (trimmed.length < REASON_MIN_LENGTH || trimmed.length > REASON_MAX_LENGTH) {
      setMessage(
        `복원 사유는 ${REASON_MIN_LENGTH}자 이상 ${REASON_MAX_LENGTH}자 이하로 입력해주세요.`
      );
      return;
    }

    setSaving(true);
    setMessage("");

    const response = await fetch(`/api/admin/care-logs/${logId}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: trimmed }),
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setSaving(false);
      setMessage(body?.error || "복원에 실패했습니다.");
      return;
    }

    // 현재 URL(예: ?includeDeleted=1)을 그대로 다시 불러와 필터 상태를
    // 유지한다 — DeleteCareLogButton과 동일한 새로고침 방식.
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
        className="shrink-0 bg-green-600 text-white text-sm px-3 py-2 rounded"
      >
        복원
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow p-5 w-full max-w-sm">
            <h2 className="font-bold text-lg mb-2">간병일지 복원</h2>

            <p className="text-sm text-gray-700 mb-4">
              삭제된 간병일지({careDate})를 복원합니다. 같은 날짜에 다른
              간병일지가 존재하면 복원할 수 없습니다.
            </p>

            <label className="block text-sm font-bold text-gray-800 mb-1">
              복원 사유 (필수)
            </label>

            <textarea
              className="w-full border p-3 rounded mb-3 text-gray-900"
              rows={3}
              placeholder="예: 착오로 삭제됨, 확인 결과 정상 기록임 등"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={saving}
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
                onClick={handleConfirmRestore}
                disabled={saving}
                className="flex-1 bg-green-600 text-white p-3 rounded font-bold disabled:opacity-50"
              >
                {saving ? "복원 중..." : "복원 확인"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
