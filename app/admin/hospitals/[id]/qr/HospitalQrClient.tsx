"use client";

import { use, useEffect, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import RegenerateQrButton from "../RegenerateQrButton";
import type { Hospital } from "@/types/domain";

export default function HospitalQrClient({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [hospital, setHospital] = useState<Hospital | null>(null);

  useEffect(() => {
    async function loadHospital() {
      const response = await fetch(`/api/admin/hospitals/${id}`);
      const body = await response.json().catch(() => null);

      if (response.ok) {
        setHospital(body.hospital);
      }
    }

    loadHospital();
  }, [id]);

  if (!hospital) {
    return <main className="p-8">병원 정보를 불러오는 중입니다.</main>;
  }

  const qrUrl = `${window.location.origin}/log?q=${hospital.qr_token}`;

  return (
    <main className="min-h-screen bg-white p-6">
      <div className="max-w-2xl mx-auto text-center border p-10">
        <h1 className="text-4xl font-bold mb-4">
          해피간병 전자간병일지
        </h1>

        <p className="text-2xl font-bold mb-2">
          {hospital.hospital_name}
        </p>

        <p className="text-gray-600 mb-8">
          병원 공용 QR
        </p>

        <div className="flex justify-center my-8">
          <QRCodeCanvas value={qrUrl} size={280} />
        </div>

        <p className="text-xl font-bold mb-4">
          QR을 스캔하여 간병일지를 작성해 주세요.
        </p>

        <p className="text-sm text-gray-600 mb-8">
          환자정보는 QR에 저장되지 않습니다.
        </p>

        <p className="text-xs break-all text-gray-500 mb-8">
          {qrUrl}
        </p>

        <div className="flex gap-3 justify-center print:hidden">
          <button
            onClick={() => window.print()}
            className="bg-blue-600 text-white px-4 py-2 rounded"
          >
            인쇄하기
          </button>

          <a
            href={qrUrl}
            target="_blank"
            className="bg-green-600 text-white px-4 py-2 rounded"
          >
            QR 테스트
          </a>

          <a
            href="/admin/hospitals"
            className="bg-gray-700 text-white px-4 py-2 rounded"
          >
            돌아가기
          </a>
        </div>
        <RegenerateQrButton
          hospitalId={hospital.hospital_id}
        />
      </div>
    </main>
  );
}
