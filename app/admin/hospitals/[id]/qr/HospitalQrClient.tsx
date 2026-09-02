"use client";

import { use, useEffect, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import RegenerateQrButton from "../RegenerateQrButton";
import type { Hospital } from "@/types/domain";

/**
 * 병원 비치용 안내문 인쇄 화면 (A4 세로 1장).
 *
 * 디자인 지침(2026-09-01):
 *   - A4 세로, 여백 15mm, 흰 배경, 핑크 계열 라운드 테두리
 *   - 색상: 메인 #EC6A8E / 연한 배경 #FFF2F5 / 연한 테두리 #FFE1E8 /
 *           강조 #D94C72 / 본문 #333333 / 보조 #666666
 *   - 구성: 제목 → 병원명 → "병원 전용 QR" 라벨 → QR(최대 크기) →
 *           스캔 안내 → 이용 안내 4항목 → 카카오채널 박스
 *   - 업무협약 안내 박스는 1장 규격을 위해 2026-09-01 사용자 결정으로 제외
 *   - 화면 전용 UI(버튼 등)는 인쇄에 포함하지 않는다(.no-print)
 *
 * 카카오채널 QR은 NEXT_PUBLIC_KAKAO_CHANNEL_URL 환경변수로 바인딩한다.
 * 미설정이면 해당 박스를 통째로 생략한다 — 빈 QR 자리가 인쇄되는 것보다
 * 낫다.
 */

/** 색상 상수 — 지침의 색상 가이드 그대로. */
const PINK = "#EC6A8E";
const PINK_BG = "#FFF2F5";
const PINK_BORDER = "#FFE1E8";
const PINK_DARK = "#D94C72";
const TEXT = "#333333";

/** 이용 안내 4항목의 선형(라인) 아이콘. 지침: 단순 선형 스타일, 핑크. */
function GuideIcon({ kind }: { kind: "phone" | "calendar" | "pin" | "lock" }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: PINK,
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (kind === "phone") {
    return (
      <svg {...common}>
        <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
        <line x1="10.5" y1="18.5" x2="13.5" y2="18.5" />
      </svg>
    );
  }

  if (kind === "calendar") {
    return (
      <svg {...common}>
        <rect x="3.5" y="5" width="17" height="16" rx="2" />
        <line x1="3.5" y1="9.5" x2="20.5" y2="9.5" />
        <line x1="8" y1="2.5" x2="8" y2="6.5" />
        <line x1="16" y1="2.5" x2="16" y2="6.5" />
        <line x1="8" y1="13.5" x2="10" y2="13.5" />
        <line x1="14" y1="13.5" x2="16" y2="13.5" />
        <line x1="8" y1="17" x2="10" y2="17" />
      </svg>
    );
  }

  if (kind === "pin") {
    return (
      <svg {...common}>
        <path d="M12 21.5c4-4.4 6.5-7.8 6.5-11A6.5 6.5 0 0 0 5.5 10.5c0 3.2 2.5 6.6 6.5 11z" />
        <circle cx="12" cy="10.5" r="2.3" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
      <circle cx="12" cy="15.5" r="1.3" fill={PINK} stroke="none" />
    </svg>
  );
}

const GUIDE_ITEMS: { icon: "phone" | "calendar" | "pin" | "lock"; text: string }[] = [
  { icon: "phone", text: "본인 휴대폰 인증 후 이용할 수 있습니다." },
  { icon: "calendar", text: "간병일지는 하루에 한 번 작성해 주세요." },
  {
    icon: "pin",
    text: "신뢰도 있는 간병일지 작성을 위해 위치정보와 사진정보(병실 내외, 케어 중 모습 등)를 추가할 수 있습니다.",
  },
  { icon: "lock", text: "작성한 간병일지는 안전하게 관리됩니다." },
];

/** 인쇄 전용 스타일 — 지침 5절 그대로. */
const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 15mm; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .no-print { display: none !important; }
  .print-container { width: 100% !important; max-width: 100% !important; padding: 0 !important; box-shadow: none !important; }
}
`;

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
  const kakaoChannelUrl = process.env.NEXT_PUBLIC_KAKAO_CHANNEL_URL || "";

  return (
    <main
      className="min-h-screen bg-gray-100 py-6"
      style={{
        color: TEXT,
        fontFamily:
          '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
      }}
    >
      <style>{PRINT_CSS}</style>

      {/* ---- 화면 전용 도구 모음 (인쇄 제외) ---- */}
      <div className="no-print print:hidden max-w-[210mm] mx-auto mb-4 bg-white border rounded-lg p-4">
        <div className="flex flex-wrap gap-3 justify-center">
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

        <p className="text-xs break-all text-gray-600 text-center mt-3">{qrUrl}</p>

        <RegenerateQrButton hospitalId={hospital.hospital_id} />

        {!kakaoChannelUrl && (
          <p className="mt-3 text-center text-xs text-red-600">
            NEXT_PUBLIC_KAKAO_CHANNEL_URL이 설정되지 않아 카카오채널 안내
            박스는 인쇄물에서 생략됩니다.
          </p>
        )}
      </div>

      {/* ---- A4 안내문 본문 ---- */}
      <div
        className="print-container mx-auto bg-white"
        style={{
          maxWidth: "210mm",
          padding: "6mm",
        }}
      >
        <div
          style={{
            border: `2.5pt solid ${PINK}`,
            borderRadius: "5mm",
            padding: "5mm 7mm",
            textAlign: "center",
          }}
        >
          {/* ① 상단 제목 영역 */}
          <h1
            style={{
              fontSize: "36pt",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              lineHeight: 1.15,
              color: "#111111",
            }}
          >
            해피간병 전자간병일지
          </h1>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "5mm",
              marginTop: "2mm",
            }}
          >
            <span style={{ width: "22mm", height: "1pt", background: PINK }} />
            <span style={{ fontSize: "20pt", fontWeight: 700, color: PINK }}>
              {hospital.hospital_name}
            </span>
            <span style={{ width: "22mm", height: "1pt", background: PINK }} />
          </div>

          <div style={{ marginTop: "2mm" }}>
            <span
              style={{
                display: "inline-block",
                background: PINK,
                color: "#ffffff",
                fontSize: "12pt",
                fontWeight: 700,
                borderRadius: "99mm",
                padding: "1.4mm 7mm",
              }}
            >
              병원 전용 QR
            </span>
          </div>

          {/* ③ QR 코드 영역 — 가장 크게, 핑크 라운드 테두리, 120mm.
              화면 해상도(px)와 무관하게 선명하도록 캔버스는 크게 그리고
              CSS로 축소해서 보여준다. */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              marginTop: "5mm",
            }}
          >
            <div
              style={{
                border: `2pt solid ${PINK}`,
                borderRadius: "4mm",
                padding: "3mm",
                background: "#ffffff",
              }}
            >
              <QRCodeCanvas
                value={qrUrl}
                size={960}
                style={{ width: "100mm", height: "100mm", display: "block" }}
              />
            </div>
          </div>

          {/* ④ 안내 문구 */}
          <p style={{ fontSize: "16pt", fontWeight: 700, marginTop: "3.5mm" }}>
            QR을 스캔하여{" "}
            <span style={{ color: PINK_DARK }}>간병일지</span>를 작성해 주세요.
          </p>

          {/* ⑤ 이용 안내 (아이콘 + 텍스트, 4항목 가로 균등) */}
          <p
            style={{
              fontSize: "12pt",
              fontWeight: 700,
              color: PINK,
              marginTop: "3.5mm",
            }}
          >
            · · · 이용 안내 · · ·
          </p>

          <div
            style={{
              display: "flex",
              alignItems: "stretch",
              marginTop: "2mm",
            }}
          >
            {GUIDE_ITEMS.map((item, index) => (
              <div
                key={item.icon}
                style={{
                  flex: "1 1 0",
                  padding: "0 2.5mm",
                  borderLeft:
                    index === 0 ? "none" : `1pt dotted ${PINK_BORDER}`,
                }}
              >
                <div
                  style={{
                    width: "11mm",
                    height: "11mm",
                    borderRadius: "50%",
                    background: PINK_BG,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 2mm",
                  }}
                >
                  <GuideIcon kind={item.icon} />
                </div>

                <p
                  style={{
                    fontSize: "9pt",
                    fontWeight: 500,
                    lineHeight: 1.45,
                    color: TEXT,
                    wordBreak: "keep-all",
                  }}
                >
                  {item.text}
                </p>
              </div>
            ))}
          </div>

          {/* ⑥ 카카오채널 안내 영역 — URL이 설정된 경우에만 */}
          {kakaoChannelUrl && (
            <div
              style={{
                background: PINK_BG,
                border: `1pt solid ${PINK_BORDER}`,
                borderRadius: "3mm",
                padding: "3mm 5mm",
                marginTop: "3.5mm",
                display: "flex",
                alignItems: "center",
                gap: "5mm",
                textAlign: "left",
              }}
            >
              <p
                style={{
                  flex: "1 1 0",
                  fontSize: "11.5pt",
                  fontWeight: 500,
                  lineHeight: 1.55,
                }}
              >
                간병일지, 간병종료 후 관련서류발급, 수수료 등 안내를 위해{" "}
                <strong style={{ color: PINK_DARK, fontWeight: 700 }}>
                  해피간병 카카오채널
                </strong>
                을 추가해주세요.
              </p>

              <div
                style={{
                  background: "#ffffff",
                  border: `1pt solid ${PINK_BORDER}`,
                  borderRadius: "2mm",
                  padding: "2mm",
                }}
              >
                <QRCodeCanvas
                  value={kakaoChannelUrl}
                  size={480}
                  style={{ width: "22mm", height: "22mm", display: "block" }}
                />
              </div>

              <p
                style={{
                  fontSize: "10pt",
                  fontWeight: 700,
                  color: PINK_DARK,
                  whiteSpace: "nowrap",
                }}
              >
                ◀ 카카오채널 추가
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
