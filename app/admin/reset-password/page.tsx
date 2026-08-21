"use client";

import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

const MIN_PASSWORD_LENGTH = 8;

export default function AdminResetPasswordPage() {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!newPassword || !confirmPassword) {
      setMessage("새 비밀번호를 입력해주세요.");
      return;
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setMessage(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상을 권장합니다.`);
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage("새 비밀번호가 일치하지 않습니다.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const supabase = createSupabaseBrowserClient();

      // 재설정 메일의 링크를 통해 들어온 경우에만 Supabase가 발급하는
      // 임시 복구 세션이 존재한다 — updateUser()는 그 세션에 의존한다.
      // 세션이 없거나 만료된 경우 여기서 error가 내려온다.
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        setMessage(
          "비밀번호 변경에 실패했습니다. 재설정 링크가 만료되었을 수 있습니다."
        );
        return;
      }

      setDone(true);
      setMessage("비밀번호가 변경되었습니다. 로그인 화면으로 이동합니다.");

      setTimeout(() => {
        window.location.href = "/admin/login";
      }, 1500);
    } catch {
      setMessage(
        "비밀번호 변경에 실패했습니다. 재설정 링크가 만료되었을 수 있습니다."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 flex items-center justify-center text-gray-900">
      <div className="max-w-md w-full bg-white rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold mb-2">새 비밀번호 설정</h1>

        <p className="text-sm text-gray-700 mb-6">
          이메일로 받으신 링크를 통해 접속하신 경우에만 비밀번호를 변경할 수
          있습니다.
        </p>

        {!done && (
          <form onSubmit={handleSubmit}>
            <label className="block mb-2 text-sm font-bold text-gray-800">
              새 비밀번호
            </label>

            <input
              className="w-full border p-3 rounded mb-4 min-h-[44px] text-gray-900 disabled:bg-gray-100"
              placeholder={`${MIN_PASSWORD_LENGTH}자 이상`}
              type="password"
              autoComplete="new-password"
              value={newPassword}
              disabled={loading}
              onChange={(event) => setNewPassword(event.target.value)}
            />

            <label className="block mb-2 text-sm font-bold text-gray-800">
              새 비밀번호 확인
            </label>

            <input
              className="w-full border p-3 rounded mb-4 min-h-[44px] text-gray-900 disabled:bg-gray-100"
              placeholder="새 비밀번호를 한 번 더 입력해주세요"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              disabled={loading}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white p-3 rounded font-bold min-h-[44px] disabled:opacity-50"
            >
              {loading ? "변경 중..." : "비밀번호 변경"}
            </button>
          </form>
        )}

        {message && (
          <p className="mt-4 text-center text-sm text-gray-900">{message}</p>
        )}

        {!done && (
          <p className="mt-4 text-center text-sm">
            <a href="/admin/login" className="text-blue-600 underline">
              로그인 화면으로 돌아가기
            </a>
          </p>
        )}
      </div>
    </main>
  );
}
