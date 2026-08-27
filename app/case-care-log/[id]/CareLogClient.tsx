"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

type LocationStatus = "checking" | "checked" | "unavailable";

interface CaregiverStatus {
  loggedIn: boolean;
  isCurrent: boolean;
  caregiverName: string | null;
}

export default function CareLogClient({
  caseId,
  patientName,
  currentCaregiverName,
  currentCaregiverRelationship,
  caregiverStatus,
  currentCaregiverChange,
}: {
  caseId: string;
  patientName: string;
  currentCaregiverName: string | null;
  currentCaregiverRelationship: string | null;
  caregiverStatus: CaregiverStatus;
  /**
   * "현재 간병인 변경" 영역. 보여줄 조건이 아닐 때는 서버(page.tsx)가
   * 아무것도 넘기지 않으므로 이 자리에 빈 카드나 제목이 남지 않는다.
   * 이 컴포넌트는 노출 여부를 스스로 판단하지 않는다.
   */
  currentCaregiverChange?: ReactNode;
}) {
  const [mealAssist, setMealAssist] = useState(false);
  const [moveAssist, setMoveAssist] = useState(false);
  const [toiletAssist, setToiletAssist] = useState(false);
  const [hygieneAssist, setHygieneAssist] = useState(false);
  const [positionChange, setPositionChange] = useState(false);

  const [memo, setMemo] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);

  const [locationStatus, setLocationStatus] =
    useState<LocationStatus>("checking");

  const [locationMessage, setLocationMessage] = useState(
    "현재 위치를 확인하고 있습니다."
  );

  const [locationFailureReason, setLocationFailureReason] = useState("");
  const [locationCheckedAt, setLocationCheckedAt] = useState<string | null>(
    null
  );

  const canWrite = caregiverStatus.loggedIn && caregiverStatus.isCurrent;

  const checkLocation = useCallback(() => {
    setLocationStatus("checking");
    setLocationMessage("현재 위치를 확인하고 있습니다...");
    setLocationFailureReason("");
    setLocationCheckedAt(null);
    setLatitude(null);
    setLongitude(null);

    if (!navigator.geolocation) {
      setLocationStatus("unavailable");
      setLocationFailureReason("geolocation_not_supported");
      setLocationCheckedAt(new Date().toISOString());
      setLocationMessage(
        "이 기기에서는 위치 확인을 지원하지 않아 미기록 사유와 함께 저장됩니다."
      );
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude);
        setLongitude(position.coords.longitude);
        setLocationStatus("checked");
        setLocationFailureReason("");
        setLocationCheckedAt(new Date().toISOString());
        setLocationMessage("위치 확인이 완료되었습니다.");
      },
      (error) => {
        let reason = "unknown_error";

        if (error.code === error.PERMISSION_DENIED) {
          reason = "permission_denied";
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          reason = "position_unavailable";
        } else if (error.code === error.TIMEOUT) {
          reason = "timeout";
        }

        setLatitude(null);
        setLongitude(null);
        setLocationStatus("unavailable");
        setLocationFailureReason(reason);
        setLocationCheckedAt(new Date().toISOString());
        setLocationMessage(
          "위치를 확인할 수 없어 미기록 사유와 함께 저장됩니다."
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  }, []);

  useEffect(() => {
    // 마운트 시 위치 확인을 자동으로 시도한다(요구사항: 간병일지 작성 화면
    // 진입 시 위치 확인 자동 실행). checkLocation의 setState 호출은 모두
    // navigator.geolocation의 비동기 콜백 안에서 일어나므로 이 규칙이
    // 우려하는 "effect 본문에서의 동기 setState"에 해당하지 않는다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkLocation();
  }, [checkLocation]);

  async function handleSave() {
    setMessage("");

    if (locationStatus === "checking") {
      setMessage("위치 확인이 끝날 때까지 잠시 기다려주세요.");
      return;
    }

    if (!canWrite) {
      setMessage("현재 간병인으로 로그인한 경우에만 작성할 수 있습니다.");
      return;
    }

    setSaving(true);
    setMessage("저장 중입니다...");

    const response = await fetch(`/api/cases/${caseId}/care-logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        meal_assist: mealAssist,
        move_assist: moveAssist,
        toilet_assist: toiletAssist,
        hygiene_assist: hygieneAssist,
        position_change: positionChange,
        memo,
        location_status: locationStatus === "checked" ? "checked" : "unavailable",
        latitude: locationStatus === "checked" ? latitude : null,
        longitude: locationStatus === "checked" ? longitude : null,
        location_checked_at: locationCheckedAt || new Date().toISOString(),
        location_failure_reason:
          locationStatus === "unavailable"
            ? locationFailureReason || "unknown_error"
            : null,
      }),
    });

    setSaving(false);

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setMessage(body?.error || "저장에 실패했습니다.");
      return;
    }

    setMessage("간병일지가 저장되었습니다. 작성기록 화면으로 이동합니다.");

    setTimeout(() => {
      window.location.href = `/cases/${caseId}/care-logs`;
    }, 1200);
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto space-y-4">
        <div className="bg-white rounded-lg shadow p-5">
          <h1 className="text-2xl font-bold">간병일지 작성</h1>

          <p className="text-gray-600 mt-2">
            환자명: {patientName}
          </p>

          <p className="text-gray-600">
            현재 간병인:{" "}
            {currentCaregiverName} (
            {currentCaregiverRelationship})
          </p>

          {!canWrite && (
            <div className="mt-4 bg-red-50 text-red-600 p-3 rounded text-sm">
              현재 간병인으로 로그인한 경우에만 작성할 수 있습니다.
              <br />

              <a
                href="/caregiver-login"
                className="underline font-bold"
              >
                간병인 로그인
              </a>
            </div>
          )}
        </div>

        {/* 작성을 시작하기 전에 현재 간병인을 확인하고 필요하면 바로 바꿀 수
            있도록, 환자/현재 간병인을 보여주는 위 카드 바로 다음에 둔다. */}
        {currentCaregiverChange}

        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="font-bold mb-4">간병활동</h2>

          {(
            [
              ["식사보조", mealAssist, setMealAssist],
              ["이동보조", moveAssist, setMoveAssist],
              ["배설보조", toiletAssist, setToiletAssist],
              ["위생관리", hygieneAssist, setHygieneAssist],
              ["체위변경", positionChange, setPositionChange],
            ] as [string, boolean, (value: boolean) => void][]
          ).map(([label, checked, setter]) => (
            <label
              key={label}
              className="flex items-center justify-between border rounded p-3 mb-2"
            >
              <span>{label}</span>

              <input
                type="checkbox"
                checked={checked}
                disabled={!canWrite}
                onChange={(event) => setter(event.target.checked)}
              />
            </label>
          ))}
        </div>

        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="font-bold mb-4">특이사항</h2>

          <textarea
            className="w-full border p-3 rounded"
            placeholder="특이사항을 입력하세요."
            value={memo}
            disabled={!canWrite}
            onChange={(event) => setMemo(event.target.value)}
          />
        </div>

        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="font-bold mb-2">위치 확인</h2>

          <p className="mb-4 text-sm text-gray-600">
            간병일지 작성 시 위치 확인을 반드시 시도합니다.
            위치를 확인할 수 없는 경우에만 미기록 사유가 저장됩니다.
          </p>

          <div className="mb-4 rounded border bg-gray-50 p-3">
            <p className="text-sm font-bold">
              위치 상태:{" "}
              {locationStatus === "checking"
                ? "확인 중"
                : locationStatus === "checked"
                  ? "확인 완료"
                  : "확인 불가"}
            </p>

            <p className="mt-1 text-sm text-gray-600">
              {locationMessage}
            </p>

            {locationStatus === "unavailable" &&
              locationFailureReason && (
                <p className="mt-2 text-xs text-red-600">
                  미기록 사유: {locationFailureReason}
                </p>
              )}

            {locationStatus === "checked" && (
              <p className="mt-2 text-xs text-green-700">
                위치정보가 간병일지에 기록됩니다.
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={checkLocation}
            disabled={!canWrite || locationStatus === "checking"}
            className="w-full border border-blue-600 text-blue-600 p-3 rounded disabled:cursor-not-allowed disabled:opacity-50"
          >
            {locationStatus === "checking"
              ? "위치 확인 중..."
              : "현재 위치 다시 확인"}
          </button>
        </div>

        {canWrite ? (
          <button
            type="button"
            onClick={handleSave}
            disabled={locationStatus === "checking" || saving}
            className="w-full bg-blue-600 text-white p-4 rounded-lg font-bold disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {locationStatus === "checking"
              ? "위치 확인 중..."
              : saving
                ? "저장 중..."
                : "저장하기"}
          </button>
        ) : (
          <a
            href="/caregiver-login"
            className="block text-center bg-gray-700 text-white p-4 rounded-lg font-bold"
          >
            간병인 로그인
          </a>
        )}

        {message && (
          <p className="text-center text-sm pb-8">
            {message}
          </p>
        )}
      </div>
    </main>
  );
}
