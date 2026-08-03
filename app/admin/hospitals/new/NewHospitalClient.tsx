"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

function makeQrToken() {
  return Math.random().toString(36).slice(2, 12).toUpperCase();
}

function makeHospitalCode() {
  return "HSP-" + Date.now().toString().slice(-6);
}

export default function NewHospitalClient() {
  const [hospitalName, setHospitalName] = useState("");
  const [hospitalAddress, setHospitalAddress] = useState("");
  const [hospitalPhone, setHospitalPhone] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit() {
    if (!hospitalName) {
      setMessage("병원명을 입력해주세요.");
      return;
    }

    setMessage("등록 중입니다...");

    const hospitalCode = makeHospitalCode();
    const qrToken = makeQrToken();

    const { data, error } = await supabase
      .from("hospitals")
      .insert({
        hospital_name: hospitalName,
        hospital_address: hospitalAddress,
        hospital_phone: hospitalPhone,
        hospital_code: hospitalCode,
        qr_token: qrToken,
        status: "active",
      })
      .select()
      .single();

    if (error) {
      setMessage("등록 실패: " + error.message);
      return;
    }

    setMessage("병원이 등록되었습니다.");

    setTimeout(() => {
      window.location.href = `/admin/hospitals/${data.hospital_id}/qr`;
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
          className="w-full bg-blue-600 text-white p-3 rounded font-bold"
        >
          등록하기
        </button>

        {message && <p className="mt-4 text-center text-sm">{message}</p>}
      </div>
    </main>
  );
}
