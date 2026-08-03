"use client";

import { useState } from "react";

export default function NewHospitalClient() {
  const [hospitalName, setHospitalName] = useState("");
  const [hospitalAddress, setHospitalAddress] = useState("");
  const [hospitalPhone, setHospitalPhone] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (!hospitalName) {
      setMessage("병원명을 입력해주세요.");
      return;
    }

    setSaving(true);
    setMessage("등록 중입니다...");

    const response = await fetch("/api/admin/hospitals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hospital_name: hospitalName,
        hospital_address: hospitalAddress,
        hospital_phone: hospitalPhone,
      }),
    });

    setSaving(false);

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setMessage(body?.error || "등록에 실패했습니다.");
      return;
    }

    setMessage("병원이 등록되었습니다.");

    setTimeout(() => {
      window.location.href = `/admin/hospitals/${body.hospital.hospital_id}/qr`;
    }, 1000);
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow p-6 mt-10">
        <h1 className="text-2xl font-bold mb-6">병원 등록</h1>

        <input
          className="w-full border p-3 rounded mb-3"
          placeholder="병원명"
          value={hospitalName}
          onChange={(e) => setHospitalName(e.target.value)}
        />

        <input
          className="w-full border p-3 rounded mb-3"
          placeholder="병원주소"
          value={hospitalAddress}
          onChange={(e) => setHospitalAddress(e.target.value)}
        />

        <input
          className="w-full border p-3 rounded mb-4"
          placeholder="대표전화"
          value={hospitalPhone}
          onChange={(e) => setHospitalPhone(e.target.value)}
        />

        <button
          onClick={handleSubmit}
          disabled={saving}
          className="w-full bg-blue-600 text-white p-3 rounded font-bold disabled:opacity-50"
        >
          {saving ? "등록 중..." : "등록하기"}
        </button>

        {message && <p className="mt-4 text-center text-sm">{message}</p>}
      </div>
    </main>
  );
}
