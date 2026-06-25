"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function CaregiverLoginPage() {
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");

  async function handleLogin() {
    if (!phone) {
      setMessage("휴대폰번호를 입력해주세요.");
      return;
    }

    const { data: caregiver, error } = await supabase
      .from("caregivers")
      .select("*")
      .eq("phone", phone.replaceAll("-", ""))
      .single();

    if (error || !caregiver) {
      setMessage("등록된 간병인을 찾을 수 없습니다.");
      return;
    }

    localStorage.setItem("caregiver_id", caregiver.caregiver_id);
    localStorage.setItem("caregiver_name", caregiver.caregiver_name);

    setMessage(`${caregiver.caregiver_name}님 로그인되었습니다.`);

    setTimeout(() => {
      window.location.href = "/";
    }, 1000);
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow p-6 mt-10">
        <h1 className="text-2xl font-bold mb-2">간병인 로그인</h1>

        <p className="text-gray-500 mb-6">
          등록된 휴대폰번호를 입력해주세요.
        </p>

        <input
          className="w-full border p-3 rounded mb-4"
          placeholder="휴대폰번호"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />

        <button
          onClick={handleLogin}
          className="w-full bg-blue-600 text-white p-3 rounded"
        >
          로그인
        </button>

        {message && <p className="mt-4 text-center text-sm">{message}</p>}
      </div>
    </main>
  );
}