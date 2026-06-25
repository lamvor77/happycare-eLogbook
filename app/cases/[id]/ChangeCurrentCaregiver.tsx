"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function ChangeCurrentCaregiver({
  caseId,
  caregivers,
}: {
  caseId: string;
  caregivers: any[];
}) {
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");
  const [loginCaregiverId, setLoginCaregiverId] = useState("");

  useEffect(() => {
    const savedCaregiverId = localStorage.getItem("caregiver_id");

    if (savedCaregiverId) {
      setLoginCaregiverId(savedCaregiverId);
    }
  }, []);

  const currentCaregiver = caregivers.find(
    (item) => item.is_current_caregiver
  );

  const canChange =
    loginCaregiverId &&
    currentCaregiver?.caregiver_id === loginCaregiverId;

  async function handleChange() {
    if (!selectedId) {
      setMessage("변경할 간병인을 선택해주세요.");
      return;
    }

    setMessage("변경 중입니다...");

    const { error: resetError } = await supabase
      .from("case_caregivers")
      .update({ is_current_caregiver: false })
      .eq("case_id", caseId);

    if (resetError) {
      setMessage("기존 간병인 해제 실패: " + resetError.message);
      return;
    }

    const { error } = await supabase
      .from("case_caregivers")
      .update({ is_current_caregiver: true })
      .eq("case_caregiver_id", selectedId);

    if (error) {
      setMessage("변경 실패: " + error.message);
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
        className="w-full bg-orange-600 text-white p-3 rounded"
      >
        현재 간병인 변경
      </button>

      {message && (
        <p className="mt-3 text-center text-sm">
          {message}
        </p>
      )}
    </div>
  );
}