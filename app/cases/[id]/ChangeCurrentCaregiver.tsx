"use client";

import { useState } from "react";
import type { CaseCaregiver } from "@/types/domain";

/**
 * 현재 간병인 변경 영역.
 *
 * 이 컴포넌트는 "보여줘도 되는 상황인지"를 스스로 판단하지 않는다 —
 * 호출부(app/cases/[id]/page.tsx)가 lib/case-caregivers.ts의 공통 규칙으로
 * 변경 권한과 활성 간병인 수(2명 이상)를 확인한 뒤에만 렌더한다. 그래서
 * 여기서는 권한 없음 안내를 따로 그리지 않는다(권한이 없으면 영역 자체가
 * 나타나지 않는다).
 *
 * caregivers도 이미 걸러진 "변경 가능한 후보"만 넘어온다 — 비활성
 * 간병인과 현재 간병인 본인은 포함되지 않는다.
 */
export default function ChangeCurrentCaregiver({
  caseId,
  caregivers,
}: {
  caseId: string;
  caregivers: CaseCaregiver[];
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

    setMessage("대표 간병인이 변경되었습니다.");

    setTimeout(() => {
      window.location.reload();
    }, 1000);
  }

  return (
    <div className="bg-white rounded-lg shadow p-5">
      <h2 className="font-bold mb-3">대표 간병인 변경</h2>

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
        {saving ? "변경 중..." : "대표 간병인 변경"}
      </button>

      {message && (
        <p className="mt-3 text-center text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
