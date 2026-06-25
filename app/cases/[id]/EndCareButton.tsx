"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function EndCareButton({
  caseId,
}: {
  caseId: string;
}) {
  const [message, setMessage] = useState("");

  async function handleEndCare() {
    const ok = confirm("간병을 종료하시겠습니까?");

    if (!ok) return;

    setMessage("간병 종료 처리 중입니다...");

    const { error } = await supabase
      .from("cases")
      .update({
        status: "간병종료",
        care_end_date: new Date().toISOString().slice(0, 10),
      })
      .eq("case_id", caseId);

    if (error) {
      setMessage("간병 종료 실패: " + error.message);
      return;
    }

    setMessage("간병이 종료되었습니다.");

    setTimeout(() => {
      window.location.reload();
    }, 1000);
  }

  return (
    <div className="bg-white rounded-lg shadow p-5">
      <button
        onClick={handleEndCare}
        className="w-full bg-red-600 text-white p-3 rounded font-bold"
      >
        간병종료
      </button>

      {message && (
        <p className="mt-3 text-center text-sm">
          {message}
        </p>
      )}
    </div>
  );
}