"use client";

import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function AdminForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setMessage("이메일을 입력해주세요.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const supabase = createSupabaseBrowserClient();

      // 이 호출은 이메일이 실제로 등록되어 있는지와 무관하게 항상 같은
      // 응답 형태를 반환한다(계정 존재 여부 노출 방지). 그래서 실패
      // 시에도 "등록되지 않은 이메일입니다" 같은 구체적인 사유를 보여주지
      // 않는다.
      const { error } = await supabase.auth.resetPasswordForEmail(
        normalizedEmail,
        {
          redirectTo: `${window.location.origin}/admin/reset-password`,
        }
      );

      if (error) {
        setMessage(
          "비밀번호 재설정 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요."
        );
        return;
      }

      setSent(true);
      setMessage(
        "입력하신 이메일로 비밀번호 재설정 안내를 보냈습니다. 메일이 보이지 않으면 스팸함도 확인해주세요."
      );
    } catch {
      setMessage(
        "비밀번호 재설정 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 flex items-center justify-center text-gray-900">
      <div className="max-w-md w-full bg-white rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold mb-2">비밀번호 재설정</h1>

        <p className="text-sm text-gray-700 mb-6">
          가입하신 관리자 이메일을 입력하시면 비밀번호 재설정 안내를
          보내드립니다.
        </p>

        {!sent && (
          <form onSubmit={handleSubmit}>
            <label className="block mb-2 text-sm font-bold text-gray-800">
              이메일
            </label>

            <input
              className="w-full border p-3 rounded mb-4 min-h-[44px] text-gray-900 disabled:bg-gray-100"
              placeholder="관리자 이메일"
              type="email"
              autoComplete="email"
              value={email}
              disabled={loading}
              onChange={(event) => setEmail(event.target.value)}
            />

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white p-3 rounded font-bold min-h-[44px] disabled:opacity-50"
            >
              {loading ? "전송 중..." : "비밀번호 재설정 메일 보내기"}
            </button>
          </form>
        )}

        {message && (
          <p className="mt-4 text-center text-sm text-gray-900">{message}</p>
        )}

        <p className="mt-4 text-center text-sm">
          <a href="/admin/login" className="text-blue-600 underline">
            로그인 화면으로 돌아가기
          </a>
        </p>
      </div>
    </main>
  );
}
