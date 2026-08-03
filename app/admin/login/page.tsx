"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type Step = "email" | "code";

export default function AdminLoginPage() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSendCode() {
    if (!email.trim()) {
      setMessage("이메일을 입력해주세요.");
      return;
    }

    setLoading(true);
    setMessage("");

    const supabase = createSupabaseBrowserClient();

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    });

    setLoading(false);

    if (error) {
      setMessage(
        "인증코드 전송에 실패했습니다. 등록된 관리자 이메일인지 확인해주세요."
      );
      return;
    }

    setStep("code");
    setMessage("입력하신 이메일로 인증코드를 보냈습니다.");
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
      email: email.trim(),
      token: code.trim(),
      type: "email",
    });

    setLoading(false);

    if (error) {
      setMessage("인증코드가 올바르지 않거나 만료되었습니다.");
      return;
    }

    setMessage("로그인되었습니다. 이동 중입니다...");

    setTimeout(() => {
      window.location.href = "/admin";
    }, 800);
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 flex items-center justify-center">
      <div className="max-w-md w-full bg-white rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold mb-2">관리자 로그인</h1>

        <p className="text-sm text-gray-500 mb-6">
          등록된 관리자 이메일로 인증코드를 받아 로그인합니다.
        </p>

        <input
          className="w-full border p-3 rounded mb-3 disabled:bg-gray-100"
          placeholder="이메일"
          type="email"
          value={email}
          disabled={step === "code"}
          onChange={(event) => setEmail(event.target.value)}
        />

        {step === "email" && (
          <button
            type="button"
            onClick={handleSendCode}
            disabled={loading}
            className="w-full bg-blue-600 text-white p-3 rounded font-bold disabled:opacity-50"
          >
            {loading ? "전송 중..." : "인증코드 받기"}
          </button>
        )}

        {step === "code" && (
          <>
            <input
              className="w-full border p-3 rounded mb-3"
              placeholder="인증코드 6자리"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />

            <button
              type="button"
              onClick={handleVerifyCode}
              disabled={loading}
              className="w-full bg-blue-600 text-white p-3 rounded font-bold disabled:opacity-50"
            >
              {loading ? "확인 중..." : "로그인"}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCode("");
                setMessage("");
              }}
              className="w-full mt-2 text-sm text-gray-500 underline"
            >
              이메일 다시 입력
            </button>
          </>
        )}

        {message && (
          <p className="mt-4 text-center text-sm">{message}</p>
        )}
      </div>
    </main>
  );
}
