"use client";

import { useState } from "react";

type Mode = "phone" | "case" | "hospital";

interface HospitalOption {
  hospital_id: string;
  hospital_name: string;
}

interface PreviewCase {
  case_id: string;
  case_no: string | null;
  patient_name_masked: string;
  status: string;
  care_log_count: number;
  linked_caregiver_count: number;
  case_will_be_deleted: boolean;
}

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

interface PreviewResult {
  found: boolean;
  preview_id: string | null;
  target_label: string;
  counts: PreviewCounts;
  cases: PreviewCase[];
}

const CONFIRMATION_TEXT = "RESET";

const COUNT_LABELS: { key: keyof PreviewCounts; label: string }[] = [
  { key: "caregivers", label: "간병인" },
  { key: "cases", label: "사례" },
  { key: "case_caregivers", label: "간병인 연결" },
  { key: "care_logs", label: "간병일지" },
  { key: "care_log_photos", label: "사진" },
  { key: "consents", label: "동의" },
  { key: "histories", label: "이력" },
  { key: "sessions", label: "세션" },
  { key: "otp_codes", label: "OTP" },
];

export default function TestResetClient({
  hospitals,
  initialCaseId,
  initialCaseLabel,
}: {
  hospitals: HospitalOption[];
  initialCaseId: string | null;
  initialCaseLabel: string | null;
}) {
  const [mode, setMode] = useState<Mode>(initialCaseId ? "case" : "phone");

  const [phone, setPhone] = useState("");
  const [hospitalId, setHospitalId] = useState("");
  const [deleteHospital, setDeleteHospital] = useState(false);
  const [revokeSessions, setRevokeSessions] = useState(true);

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [resultSummary, setResultSummary] = useState("");

  function resetPreviewState() {
    setPreview(null);
    setSelectedCaseIds([]);
    setConfirmation("");
    setResultSummary("");
  }

  function changeMode(nextMode: Mode) {
    setMode(nextMode);
    resetPreviewState();
    setMessage("");
  }

  async function handlePreview() {
    if (loading) return;

    setLoading(true);
    setMessage("");
    setResultSummary("");

    const payload: Record<string, unknown> = { mode };

    if (mode === "phone") payload.phone = phone;
    if (mode === "case") payload.case_id = initialCaseId;
    if (mode === "hospital") payload.hospital_id = hospitalId;

    const response = await fetch("/api/admin/test-reset/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const body = await response.json().catch(() => null);

    setLoading(false);

    if (!response.ok) {
      setPreview(null);
      setMessage(body?.error || "삭제 대상 확인에 실패했습니다.");
      return;
    }

    if (!body.found) {
      setPreview(null);
      setMessage(`${body.target_label} — 초기화할 데이터가 없습니다.`);
      return;
    }

    setPreview({
      found: true,
      preview_id: body.preview_id,
      target_label: body.target_label,
      counts: body.counts,
      cases: body.cases || [],
    });

    // 휴대폰 기준은 기본적으로 전부 선택하되, 관리자가 사례별로 해제할 수 있다.
    setSelectedCaseIds((body.cases || []).map((item: PreviewCase) => item.case_id));
    setConfirmation("");
    setMessage("");
  }

  async function handleExecute() {
    if (loading) return;

    if (!preview?.preview_id) {
      setMessage("삭제 대상 확인을 먼저 실행해주세요.");
      return;
    }

    if (confirmation !== CONFIRMATION_TEXT) {
      setMessage(`확인문구 ${CONFIRMATION_TEXT}을(를) 정확히 입력해주세요.`);
      return;
    }

    if (mode === "phone" && selectedCaseIds.length === 0) {
      setMessage("초기화할 사례를 하나 이상 선택해주세요.");
      return;
    }

    setLoading(true);
    setMessage("");

    const response = await fetch("/api/admin/test-reset/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preview_id: preview.preview_id,
        mode,
        confirmation,
        case_ids: mode === "phone" ? selectedCaseIds : undefined,
        delete_hospital: mode === "hospital" ? deleteHospital : undefined,
        revoke_sessions: revokeSessions,
      }),
    });

    const body = await response.json().catch(() => null);

    setLoading(false);
    setModalOpen(false);

    if (!response.ok) {
      setMessage(body?.error || "초기화에 실패했습니다.");
      return;
    }

    resetPreviewState();
    setResultSummary(body.summary || "초기화가 완료되었습니다.");
    setMessage("초기화가 완료되었습니다. 같은 휴대폰번호로 최초 등록부터 다시 테스트할 수 있습니다.");
  }

  const canOpenModal =
    Boolean(preview?.preview_id) &&
    confirmation === CONFIRMATION_TEXT &&
    (mode !== "phone" || selectedCaseIds.length > 0);

  return (
    <div className="space-y-4">
      {/* 모드 선택 */}
      <div className="bg-white rounded-lg border p-5">
        <h2 className="font-bold mb-3">초기화 기준</h2>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => changeMode("phone")}
            className={`px-3 py-2 rounded text-sm min-h-[44px] ${
              mode === "phone" ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-800"
            }`}
          >
            휴대폰 번호 기준
          </button>

          <button
            type="button"
            onClick={() => changeMode("case")}
            className={`px-3 py-2 rounded text-sm min-h-[44px] ${
              mode === "case" ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-800"
            }`}
          >
            사례 기준
          </button>

          <button
            type="button"
            onClick={() => changeMode("hospital")}
            className={`px-3 py-2 rounded text-sm min-h-[44px] ${
              mode === "hospital" ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-800"
            }`}
          >
            병원 기준
          </button>
        </div>

        <div className="mt-4">
          {mode === "phone" && (
            <>
              <label className="block text-sm font-bold text-gray-800 mb-1">
                간병인 휴대폰 번호
              </label>
              <input
                className="w-full border p-3 rounded min-h-[44px] text-gray-900"
                placeholder="010-0000-0000"
                inputMode="numeric"
                autoComplete="off"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  resetPreviewState();
                }}
              />
            </>
          )}

          {mode === "case" && (
            <div className="text-sm text-gray-700">
              {initialCaseId ? (
                <p>
                  대상 사례: <span className="font-bold">{initialCaseLabel || initialCaseId}</span>
                </p>
              ) : (
                <p className="text-orange-800">
                  사례 기준 초기화는 관리자 사례 목록의 [테스트 초기화] 버튼으로
                  들어와야 합니다(사례 id 직접 입력은 지원하지 않습니다).
                </p>
              )}
            </div>
          )}

          {mode === "hospital" && (
            <>
              <label className="block text-sm font-bold text-gray-800 mb-1">
                병원 선택
              </label>
              <select
                className="w-full border p-3 rounded min-h-[44px] text-gray-900"
                value={hospitalId}
                onChange={(e) => {
                  setHospitalId(e.target.value);
                  resetPreviewState();
                }}
              >
                <option value="">병원을 선택하세요</option>
                {hospitals.map((hospital) => (
                  <option key={hospital.hospital_id} value={hospital.hospital_id}>
                    {hospital.hospital_name}
                  </option>
                ))}
              </select>

              <label className="flex items-start gap-2 mt-3 text-sm text-gray-900">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={deleteHospital}
                  onChange={(e) => {
                    setDeleteHospital(e.target.checked);
                    resetPreviewState();
                  }}
                />
                <span>
                  병원 정보까지 삭제 — 체크하지 않으면 병원/QR은 유지되어 같은
                  QR로 반복 테스트할 수 있습니다(권장).
                </span>
              </label>
            </>
          )}

          <label className="flex items-start gap-2 mt-3 text-sm text-gray-900">
            <input
              type="checkbox"
              className="mt-1"
              checked={revokeSessions}
              onChange={(e) => setRevokeSessions(e.target.checked)}
            />
            <span>
              간병인이 유지되는 경우에도 로그인 세션을 해제한다(같은 번호로 OTP부터
              다시 테스트할 때 권장).
            </span>
          </label>
        </div>

        <button
          type="button"
          onClick={handlePreview}
          disabled={
            loading ||
            (mode === "phone" && !phone.trim()) ||
            (mode === "case" && !initialCaseId) ||
            (mode === "hospital" && !hospitalId)
          }
          className="w-full mt-4 bg-gray-700 text-white p-3 rounded min-h-[44px] disabled:opacity-50"
        >
          {loading ? "확인 중..." : "삭제 대상 확인"}
        </button>
      </div>

      {/* Preview 결과 */}
      {preview && (
        <div className="bg-white rounded-lg border p-5 space-y-3">
          <h2 className="font-bold">삭제 대상 확인</h2>
          <p className="text-sm text-gray-700">{preview.target_label}</p>

          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            {COUNT_LABELS.map((item) => (
              <div key={item.key} className="border rounded p-2">
                <p className="text-gray-700">{item.label}</p>
                <p className="text-xl font-bold">{preview.counts[item.key]}</p>
              </div>
            ))}
          </div>

          {mode === "phone" && preview.cases.length > 0 && (
            <div>
              <p className="text-sm font-bold text-gray-800 mb-2">
                초기화할 사례 선택
              </p>

              <div className="space-y-2">
                {preview.cases.map((item) => (
                  <label
                    key={item.case_id}
                    className="flex items-start gap-2 border rounded p-3 text-sm text-gray-900"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selectedCaseIds.includes(item.case_id)}
                      onChange={(e) =>
                        setSelectedCaseIds((prev) =>
                          e.target.checked
                            ? [...prev, item.case_id]
                            : prev.filter((id) => id !== item.case_id)
                        )
                      }
                    />
                    <span>
                      {item.case_no || item.case_id.slice(0, 8)} · 환자{" "}
                      {item.patient_name_masked} · {item.status} · 간병일지{" "}
                      {item.care_log_count}건
                      <br />
                      {item.case_will_be_deleted
                        ? "이 간병인이 유일한 연결이라 사례 전체가 삭제됩니다."
                        : `다른 간병인 ${item.linked_caregiver_count - 1}명이 남아 있어 사례는 유지되고 이 간병인의 기록만 삭제됩니다.`}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <p className="text-sm text-gray-700">
            초기화 후 같은 휴대폰 번호로 최초 등록부터 다시 테스트할 수 있습니다.
          </p>

          <div>
            <label className="block text-sm font-bold text-gray-800 mb-1">
              확인문구 입력 ({CONFIRMATION_TEXT})
            </label>
            <input
              className="w-full border p-3 rounded min-h-[44px] text-gray-900"
              placeholder={CONFIRMATION_TEXT}
              autoComplete="off"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </div>

          <button
            type="button"
            onClick={() => setModalOpen(true)}
            disabled={loading || !canOpenModal}
            className="w-full bg-red-600 text-white p-4 rounded-lg font-bold min-h-[44px] disabled:opacity-50"
          >
            테스트 데이터 초기화
          </button>
        </div>
      )}

      {message && (
        <p className="text-center text-sm text-gray-900">{message}</p>
      )}

      {resultSummary && (
        <div className="rounded border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          <p className="font-bold">초기화 결과</p>
          <p className="mt-1">{resultSummary}</p>
        </div>
      )}

      {/* 2차 확인 모달 */}
      {modalOpen && preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow p-5 w-full max-w-sm">
            <h2 className="font-bold text-lg mb-2 text-red-700">
              테스트 데이터 초기화 실행
            </h2>

            <p className="text-sm text-gray-700 mb-3">
              {preview.target_label} 의 테스트 데이터를 삭제합니다. 이 작업은
              되돌릴 수 없습니다.
            </p>

            <div className="text-sm text-gray-900 mb-4 border rounded p-3">
              {COUNT_LABELS.filter((item) => preview.counts[item.key] > 0).map((item) => (
                <p key={item.key}>
                  {item.label}: {preview.counts[item.key]}
                </p>
              ))}
              {mode === "hospital" && deleteHospital && <p>병원 정보까지 삭제</p>}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={loading}
                className="flex-1 bg-gray-200 text-gray-800 p-3 rounded min-h-[44px] disabled:opacity-50"
              >
                취소
              </button>

              <button
                type="button"
                onClick={handleExecute}
                disabled={loading}
                className="flex-1 bg-red-600 text-white p-3 rounded font-bold min-h-[44px] disabled:opacity-50"
              >
                {loading ? "초기화 중..." : "초기화 실행"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
