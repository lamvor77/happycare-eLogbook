"use client";

import { useState } from "react";

export default function RegenerateQrButton({
  hospitalId,
}: {
  hospitalId: string;
}) {
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleRegenerate() {
    const ok = confirm(
      "QR을 재발급하면 기존 QR은 사용할 수 없습니다. 계속하시겠습니까?"
    );

    if (!ok) return;

    setSaving(true);
    setMessage("QR 재발급 중입니다...");

    const response = await fetch(
      `/api/admin/hospitals/${hospitalId}/regenerate-qr`,
      { method: "POST" }
    );

    setSaving(false);

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setMessage(body?.error || "QR 재발급에 실패했습니다.");
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
        disabled={saving}
        className="bg-red-600 text-white px-4 py-2 rounded disabled:opacity-50"
      >
        {saving ? "재발급 중..." : "QR 재발급"}
      </button>

      {message && <p className="mt-3 text-sm text-red-600">{message}</p>}
    </div>
  );
}
