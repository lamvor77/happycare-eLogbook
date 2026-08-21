"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 최근 등록 사례 카드에서 바로 실행하는 "테스트 초기화" 빠른 버튼.
 * 새 삭제 로직을 만들지 않고, /admin/test-reset이 쓰는 것과 동일한
 * preview/execute API(mode="case")를 그대로 호출한다 — RESET 확인문구,
 * Preview 필수, 서버 재검증, admin_audit_logs 기록도 전부 그 API가
 * 담당한다. 이 버튼은 병원 삭제 옵션을 제공하지 않는다(case 모드는 병원을
 * 건드리지 않는다) — 병원 단위 초기화가 필요하면 /admin/test-reset을
 * 이용해야 한다.
 */

interface PreviewCounts {
  caregivers: number;
  cases: number;
  case_caregivers: number;
  care_logs: number;
  care_log_photos: number;
  consents: number;
  histories: number;
  sessions: number;
  otp_codes: number;
}

const COUNT_LABELS: { key: keyof PreviewCounts; label: string }[] = [
  { key: "cases", label: "사례" },
  { key: "case_caregivers", label: "간병인 연결" },
  { key: "care_logs", label: "간병일지" },
  { key: "care_log_photos", label: "사진" },
  { key: "consents", label: "동의" },
  { key: "histories", label: "사례 이력" },
  { key: "sessions", label: "세션" },
  { key: "caregivers", label: "간병인(삭제 대상)" },
  { key: "otp_codes", label: "OTP" },
];

const CONFIRMATION_TEXT = "RESET";

export default function RecentCaseTestResetButton({
  caseId,
}: {
  caseId: string;
}) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [previewId, setPreviewId] = useState<string | null>(null);
  const [targetLabel, setTargetLabel] = useState("");
  const [counts, setCounts] = useState<PreviewCounts | null>(null);
  const [confirmation, setConfirmation] = useState("");

  async function handleOpen() {
    if (loading) return;

    setOpen(true);
    setLoading(true);
    setMessage("");
    setPreviewId(null);
    setCounts(null);
    setConfirmation("");

    const response = await fetch("/api/admin/test-reset/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "case", case_id: caseId }),
    });

    const body = await response.json().catch(() => null);

    setLoading(false);

    if (!response.ok) {
      setMessage(body?.error || "삭제 대상 확인에 실패했습니다.");
      return;
    }

    if (!body.found) {
      setMessage("초기화할 테스트 데이터가 없습니다.");
      return;
    }

    setPreviewId(body.preview_id);
    setTargetLabel(body.target_label);
    setCounts(body.counts);
  }

  function handleClose() {
    if (loading) return;
    setOpen(false);
  }

  async function handleExecute() {
    if (loading) return;

    if (!previewId) {
      setMessage("삭제 대상 확인을 먼저 실행해주세요.");
      return;
    }

    if (confirmation !== CONFIRMATION_TEXT) {
      setMessage(`확인문구 ${CONFIRMATION_TEXT}을(를) 정확히 입력해주세요.`);
      return;
    }

    setLoading(true);
    setMessage("");

    const response = await fetch("/api/admin/test-reset/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preview_id: previewId,
        mode: "case",
        confirmation,
        revoke_sessions: true,
      }),
    });

    const body = await response.json().catch(() => null);

    setLoading(false);

    if (!response.ok) {
      setMessage(body?.error || "초기화에 실패했습니다.");
      return;
    }

    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-block mt-3 ml-2 bg-red-100 text-red-800 px-3 py-2 rounded text-sm font-bold min-h-[44px]"
      >
        테스트 초기화
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow p-5 w-full max-w-sm text-gray-900">
            <div className="rounded border border-red-300 bg-red-50 p-3 mb-3">
              <p className="text-sm font-bold text-red-800">
                이 기능은 QA/테스트 데이터 정리용입니다.
              </p>
            </div>

            <h2 className="font-bold text-lg mb-2">테스트 초기화</h2>

            {loading && !counts && (
              <p className="text-sm text-gray-700">삭제 대상을 확인하는 중입니다...</p>
            )}

            {counts && (
              <>
                <p className="text-sm text-gray-700 mb-3">{targetLabel}</p>

                <div className="grid grid-cols-3 gap-2 text-center text-sm mb-3">
                  {COUNT_LABELS.map((item) => (
                    <div key={item.key} className="border rounded p-2">
                      <p className="text-gray-700">{item.label}</p>
                      <p className="text-lg font-bold">{counts[item.key]}</p>
                    </div>
                  ))}
                </div>

                <p className="text-xs text-gray-700 mb-3">
                  병원/QR은 유지됩니다. 다른 사례에도 연결된 간병인은 삭제되지
                  않고, 이 사례와의 연결과 세션만 정리됩니다.
                </p>

                <label className="block text-sm font-bold text-gray-800 mb-1">
                  확인문구 입력 ({CONFIRMATION_TEXT})
                </label>
                <input
                  className="w-full border p-3 rounded mb-3 min-h-[44px] text-gray-900"
                  placeholder={CONFIRMATION_TEXT}
                  autoComplete="off"
                  value={confirmation}
                  disabled={loading}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </>
            )}

            {message && (
              <p className="text-sm text-red-600 mb-3">{message}</p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleClose}
                disabled={loading}
                className="flex-1 bg-gray-200 text-gray-800 p-3 rounded min-h-[44px] disabled:opacity-50"
              >
                취소
              </button>

              <button
                type="button"
                onClick={handleExecute}
                disabled={loading || !counts || confirmation !== CONFIRMATION_TEXT}
                className="flex-1 bg-red-600 text-white p-3 rounded font-bold min-h-[44px] disabled:opacity-50"
              >
                {loading ? "처리 중..." : "초기화"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
