"use client";

import { useState } from "react";

export default function CaregiverLogoutButton() {
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);

    await fetch("/api/caregiver-auth/logout", { method: "POST" });

    window.location.href = "/caregiver-login";
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className="text-sm text-gray-700 underline disabled:opacity-50"
    >
      {loading ? "로그아웃 중..." : "로그아웃"}
    </button>
  );
}
