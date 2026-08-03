"use client";

import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setMessage("이메일을 입력해주세요.");
      return;
    }

    if (!password) {
      setMessage("비밀번호를 입력해주세요.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const supabase = createSupabaseBrowserClient();

      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) {
        setMessage(
          "로그인에 실패했습니다. 이메일과 비밀번호를 확인해주세요."
        );
        return;
      }

      setMessage("로그인되었습니다. 관리자 화면으로 이동합니다.");

      window.location.href = "/admin";
    } catch {
      setMessage("로그인 처리 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 flex items-center justify-center">
      <div className="max-w-md w-full bg-white rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold mb-2">
          관리자 로그인
        </h1>

        <p className="text-sm text-gray-500 mb-6">
          등록된 관리자 이메일과 비밀번호를 입력해주세요.
        </p>

        <form onSubmit={handleLogin}>
          <label className="block mb-2 text-sm font-bold">
            이메일
          </label>

          <input
            className="w-full border p-3 rounded mb-4 disabled:bg-gray-100"
            placeholder="관리자 이메일"
            type="email"
            autoComplete="email"
            value={email}
            disabled={loading}
            onChange={(event) => setEmail(event.target.value)}
          />

          <label className="block mb-2 text-sm font-bold">
            비밀번호
          </label>

          <input
            className="w-full border p-3 rounded mb-4 disabled:bg-gray-100"
            placeholder="비밀번호"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={loading}
            onChange={(event) => setPassword(event.target.value)}
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white p-3 rounded font-bold disabled:opacity-50"
          >
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>

        {message && (
          <p className="mt-4 text-center text-sm">
            {message}
          </p>
        )}
      </div>
    </main>
  );
}