"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { toE164 } from "@/lib/phone";

type Step = "phone" | "code";

export default function CaregiverLoginPage() {
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // 예전 방식(휴대폰번호 조회 + localStorage 저장)의 잔여 값은
    // 더 이상 권한 판단에 쓰이지 않으므로 제거한다.
    localStorage.removeItem("caregiver_id");
    localStorage.removeItem("caregiver_name");
  }, []);

  async function handleSendCode() {
    if (!phone.trim()) {
      setMessage("휴대폰번호를 입력해주세요.");
      return;
    }

    setLoading(true);
    setMessage("");

    const supabase = createSupabaseBrowserClient();

    const { error } = await supabase.auth.signInWithOtp({
      phone: toE164(phone),
      options: { shouldCreateUser: false },
    });

    setLoading(false);

    if (error) {
      setMessage(
        "인증코드 전송에 실패했습니다. 등록된 휴대폰번호인지 확인해주세요."
      );
      return;
    }

    setStep("code");
    setMessage("입력하신 휴대폰으로 인증코드를 보냈습니다.");
  }

  async function handleVerifyCode() {
    if (!code.trim()) {
      setMessage("인증코드를 입력해주세요.");
      return;
    }

    setLoading(true);
    setMessage("");

    const supabase = createSupabaseBrowserClient();

    const { error } = await supabase.auth.verifyOtp({
      phone: toE164(phone),
      token: code.trim(),
      type: "sms",
    });

    if (error) {
      setLoading(false);
      setMessage("인증코드가 올바르지 않거나 만료되었습니다.");
      return;
    }

    const meResponse = await fetch("/api/caregiver/me");
    const meBody = await meResponse.json().catch(() => null);

    setLoading(false);

    if (!meResponse.ok || !meBody?.caregiver) {
      setMessage(
        "이 휴대폰번호로 등록된 간병인 정보를 찾을 수 없습니다. 담당자에게 문의해주세요."
      );
      return;
    }

    localStorage.removeItem("caregiver_id");
    localStorage.removeItem("caregiver_name");

    setMessage(`${meBody.caregiver.caregiver_name}님 로그인되었습니다.`);

    setTimeout(() => {
      window.location.href = "/my-cases";
    }, 1000);
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow p-6 mt-10">
        <h1 className="text-2xl font-bold mb-2">간병인 로그인</h1>

        <p className="text-gray-500 mb-6">
          등록된 휴대폰번호로 인증코드를 받아 로그인합니다.
        </p>

        <input
          className="w-full border p-3 rounded mb-4 disabled:bg-gray-100"
          placeholder="휴대폰번호"
          value={phone}
          disabled={step === "code"}
          onChange={(e) => setPhone(e.target.value)}
        />

        {step === "phone" && (
          <button
            onClick={handleSendCode}
            disabled={loading}
            className="w-full bg-blue-600 text-white p-3 rounded disabled:opacity-50"
          >
            {loading ? "전송 중..." : "인증코드 받기"}
          </button>
        )}

        {step === "code" && (
          <>
            <input
              className="w-full border p-3 rounded mb-4"
              placeholder="인증코드 6자리"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />

            <button
              onClick={handleVerifyCode}
              disabled={loading}
              className="w-full bg-blue-600 text-white p-3 rounded disabled:opacity-50"
            >
              {loading ? "확인 중..." : "로그인"}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep("phone");
                setCode("");
                setMessage("");
              }}
              className="w-full mt-2 text-sm text-gray-500 underline"
            >
              휴대폰번호 다시 입력
            </button>
          </>
        )}

        {message && <p className="mt-4 text-center text-sm">{message}</p>}
      </div>
    </main>
  );
}
