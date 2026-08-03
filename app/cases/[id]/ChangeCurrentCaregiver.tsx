"use client";

import { useState } from "react";
import type { CaseCaregiver } from "@/types/domain";

export default function ChangeCurrentCaregiver({
  caseId,
  caregivers,
  canChange,
}: {
  caseId: string;
  caregivers: CaseCaregiver[];
  canChange: boolean;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleChange() {
    if (!selectedId) {
      setMessage("변경할 간병인을 선택해주세요.");
      return;
    }

    setSaving(true);
    setMessage("변경 중입니다...");

    const response = await fetch(`/api/cases/${caseId}/current-caregiver`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ case_caregiver_id: selectedId }),
    });

    setSaving(false);

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setMessage(body?.error || "변경에 실패했습니다.");
      return;
    }

    setMessage("현재 간병인이 변경되었습니다.");

    setTimeout(() => {
      window.location.reload();
    }, 1000);
  }

  if (!canChange) {
    return (
      <div className="bg-white rounded-lg shadow p-5">
        <h2 className="font-bold mb-3">현재 간병인 변경</h2>

        <p className="text-sm text-gray-600">
          현재 간병인으로 로그인한 경우에만 변경할 수 있습니다.
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
      <h2 className="font-bold mb-3">현재 간병인 변경</h2>

      <select
        className="w-full border p-3 rounded mb-3"
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
      >
        <option value="">변경할 간병인 선택</option>

        {caregivers.map((item) => (
          <option
            key={item.case_caregiver_id}
            value={item.case_caregiver_id}
          >
            {item.caregivers?.caregiver_name} ({item.relationship})
          </option>
        ))}
      </select>

      <button
        onClick={handleChange}
        disabled={saving}
        className="w-full bg-orange-600 text-white p-3 rounded disabled:opacity-50"
      >
        {saving ? "변경 중..." : "현재 간병인 변경"}
      </button>

      {message && (
        <p className="mt-3 text-center text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
