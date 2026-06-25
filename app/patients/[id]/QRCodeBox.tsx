"use client";

import { QRCodeCanvas } from "qrcode.react";

export default function QRCodeBox({
  inviteCode,
}: {
  inviteCode: string;
}) {
  const inviteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/invite?code=${inviteCode}`
      : "";

  return (
    <div className="border rounded p-4 mb-8">
      <h2 className="font-bold mb-3">가족 초대 QR</h2>
      <QRCodeCanvas value={inviteUrl} size={160} />
      <p className="mt-3 text-sm text-gray-600">
        가족이 QR을 스캔하면 초대코드 입력 화면으로 이동합니다.
      </p>
    </div>
  );
}