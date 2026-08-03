"use client";

import { use, useEffect, useState } from "react";

export default function EditHospitalClient({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [hospitalName, setHospitalName] = useState("");
  const [hospitalAddress, setHospitalAddress] = useState("");
  const [hospitalPhone, setHospitalPhone] = useState("");
  const [status, setStatus] = useState("active");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function loadHospital() {
      const response = await fetch(`/api/admin/hospitals/${id}`);
      const body = await response.json().catch(() => null);

      if (response.ok && body?.hospital) {
        setHospitalName(body.hospital.hospital_name || "");
        setHospitalAddress(body.hospital.hospital_address || "");
        setHospitalPhone(body.hospital.hospital_phone || "");
        setStatus(body.hospital.status || "active");
      }
    }

    loadHospital();
  }, [id]);

  async function handleSave() {
    if (!hospitalName) {
      setMessage("병원명을 입력해주세요.");
      return;
    }

    setSaving(true);
    setMessage("저장 중입니다...");

    const response = await fetch(`/api/admin/hospitals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hospital_name: hospitalName,
        hospital_address: hospitalAddress,
        hospital_phone: hospitalPhone,
        status,
      }),
    });

    setSaving(false);

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setMessage(body?.error || "저장에 실패했습니다.");
      return;
    }

    setMessage("병원 정보가 수정되었습니다.");

    setTimeout(() => {
      window.location.href = "/admin/hospitals";
    }, 1000);
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow p-6 mt-10">
        <h1 className="text-2xl font-bold mb-6">병원 수정</h1>

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
          className="w-full border p-3 rounded mb-3"
          placeholder="대표전화"
          value={hospitalPhone}
          onChange={(e) => setHospitalPhone(e.target.value)}
        />

        <select
          className="w-full border p-3 rounded mb-4"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="active">운영중</option>
          <option value="inactive">비활성</option>
        </select>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-blue-600 text-white p-3 rounded font-bold disabled:opacity-50"
        >
          {saving ? "저장 중..." : "저장하기"}
        </button>

        {message && (
          <p className="mt-4 text-center text-sm">
            {message}
          </p>
        )}
      </div>
    </main>
  );
}
