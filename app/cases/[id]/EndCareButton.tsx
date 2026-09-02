"use client";

import { useState } from "react";

export default function EndCareButton({
  caseId,
  canEnd,
}: {
  caseId: string;
  canEnd: boolean;
}) {
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleEndCare() {
    const ok = confirm("간병을 종료하시겠습니까?");
    if (!ok) return;

    setSaving(true);
    setMessage("간병 종료 처리 중입니다...");

    const response = await fetch(`/api/cases/${caseId}/end-care`, {
      method: "POST",
    });

    setSaving(false);

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setMessage(body?.error || "간병 종료에 실패했습니다.");
      return;
    }

    setMessage("간병이 종료되었습니다.");

    setTimeout(() => {
      window.location.reload();
    }, 1000);
  }

  if (!canEnd) {
    return (
      <div className="bg-white rounded-lg shadow p-5">
        <p className="text-sm text-gray-600">
          대표 간병인으로 로그인한 경우에만 간병을 종료할 수 있습니다.
        </p>

        <a
          href="/caregiver-login"
          className="inline-block mt-3 bg-blue-600 text-white px-4 py-2 rounded"
        >
          간병인 로그인
        </a>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-5">
      <button
        onClick={handleEndCare}
        disabled={saving}
        className="w-full bg-red-600 text-white p-3 rounded font-bold disabled:opacity-50"
      >
        {saving ? "처리 중..." : "간병종료"}
      </button>

      {message && (
        <p className="mt-3 text-center text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
