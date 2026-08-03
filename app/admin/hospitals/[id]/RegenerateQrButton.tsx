"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

function makeQrToken() {
  return Math.random().toString(36).slice(2, 12).toUpperCase();
}

export default function RegenerateQrButton({
  hospitalId,
}: {
  hospitalId: string;
}) {
  const [message, setMessage] = useState("");

  async function handleRegenerate() {
    const ok = confirm(
      "QR을 재발급하면 기존 QR은 사용할 수 없습니다. 계속하시겠습니까?"
    );

    if (!ok) return;

    setMessage("QR 재발급 중입니다...");

    const { error } = await supabase
      .from("hospitals")
      .update({
        qr_token: makeQrToken(),
      })
      .eq("hospital_id", hospitalId);

    if (error) {
      setMessage("QR 재발급 실패: " + error.message);
      return;
    }

    setMessage("QR이 재발급되었습니다.");

    setTimeout(() => {
      window.location.reload();
    }, 1000);
  }

  return (
    <div className="mt-4 print:hidden">
      <button
        onClick={handleRegenerate}
        className="bg-red-600 text-white px-4 py-2 rounded"
      >
        QR 재발급
      </button>

      {message && <p className="mt-3 text-sm text-red-600">{message}</p>}
    </div>
  );
}