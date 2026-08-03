"use client";

import { use, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type LocationStatus = "checking" | "checked" | "unavailable";

export default function CaseCareLogPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const caseId = id;

  const [caseData, setCaseData] = useState<any>(null);
  const [currentCaregiver, setCurrentCaregiver] = useState<any>(null);
  const [loginCaregiverId, setLoginCaregiverId] = useState("");

  const [mealAssist, setMealAssist] = useState(false);
  const [moveAssist, setMoveAssist] = useState(false);
  const [toiletAssist, setToiletAssist] = useState(false);
  const [hygieneAssist, setHygieneAssist] = useState(false);
  const [positionChange, setPositionChange] = useState(false);

  const [memo, setMemo] = useState("");
  const [message, setMessage] = useState("");

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
    const savedCaregiverId = localStorage.getItem("caregiver_id");

    if (savedCaregiverId) {
      setLoginCaregiverId(savedCaregiverId);
    }

    async function loadCase() {
      const { data, error } = await supabase
        .from("cases")
        .select(`
          *,
          hospitals (*),
          case_caregivers (
            *,
            caregivers (*)
          )
        `)
        .eq("case_id", caseId)
        .single();

      if (error) {
        setMessage("사례 정보 조회 실패: " + error.message);
        return;
      }

      setCaseData(data || null);

      const current = data?.case_caregivers?.find(
        (item: any) => item.is_current_caregiver
      );

      setCurrentCaregiver(current || null);
    }

    loadCase();
    checkLocation();
  }, [caseId, checkLocation]);

  const canWrite =
    Boolean(loginCaregiverId) &&
    currentCaregiver?.caregiver_id === loginCaregiverId;

  async function handleSave() {
    setMessage("");

    if (locationStatus === "checking") {
      setMessage("위치 확인이 끝날 때까지 잠시 기다려주세요.");
      return;
    }

    if (!caseData || !currentCaregiver) {
      setMessage("현재 간병인 정보를 찾을 수 없습니다.");
      return;
    }

    if (!canWrite) {
      setMessage("현재 간병인으로 로그인한 경우에만 작성할 수 있습니다.");
      return;
    }

    setMessage("저장 중입니다...");

    const today = new Date().toISOString().slice(0, 10);

    const { data: existingLogs, error: checkError } = await supabase
      .from("care_logs")
      .select("log_id")
      .eq("case_id", caseId)
      .eq("care_date", today);

    if (checkError) {
      setMessage("기존 기록 확인 실패: " + checkError.message);
      return;
    }

    if (existingLogs && existingLogs.length > 0) {
      setMessage("오늘은 이미 작성된 간병일지가 있습니다.");
      return;
    }

    const { error } = await supabase.from("care_logs").insert({
      case_id: caseId,
      caregiver_id: currentCaregiver.caregiver_id,
      hospital_id: caseData.hospital_id,
      care_date: today,

      meal_assist: mealAssist,
      move_assist: moveAssist,
      toilet_assist: toiletAssist,
      hygiene_assist: hygieneAssist,
      position_change: positionChange,

      memo,
      relationship: currentCaregiver.relationship,
      writer_name: currentCaregiver.caregivers?.caregiver_name,
      signature_name: currentCaregiver.caregivers?.caregiver_name,

      hospital_confirmed: true,

      latitude: locationStatus === "checked" ? latitude : null,
      longitude: locationStatus === "checked" ? longitude : null,

      location_checked_at:
        locationCheckedAt || new Date().toISOString(),

      location_status:
        locationStatus === "checked" ? "checked" : "unavailable",

      location_failure_reason:
        locationStatus === "unavailable"
          ? locationFailureReason || "unknown_error"
          : null,
    });

    if (error) {
      setMessage("저장 실패: " + error.message);
      return;
    }

    await supabase.from("case_history").insert({
      case_id: caseId,
      history_type: "CARELOG",
      title: "간병일지 작성",
      action: "간병일지 작성",
      description: `${today} 간병일지가 작성되었습니다.`,
      actor: currentCaregiver.caregivers?.caregiver_name || "현재 간병인",
      created_by_id: currentCaregiver.caregiver_id,
      after_data: {
        care_date: today,
        location_status:
          locationStatus === "checked" ? "checked" : "unavailable",
      },
    });

    setMessage("간병일지가 저장되었습니다.");

    setTimeout(() => {
      window.location.href = `/cases/${caseId}/care-logs`;
    }, 1200);
  }

  if (!caseData) {
    return (
      <main className="p-8">
        {message || "사례 정보를 불러오는 중입니다."}
      </main>
    );
  }

  if (!currentCaregiver) {
    return (
      <main className="p-8">
        현재 간병인이 지정되어 있지 않습니다.
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto space-y-4">
        <div className="bg-white rounded-lg shadow p-5">
          <h1 className="text-2xl font-bold">간병일지 작성</h1>

          <p className="text-gray-600 mt-2">
            환자명: {caseData.patient_name}
          </p>

          <p className="text-gray-600">
            현재 간병인:{" "}
            {currentCaregiver.caregivers?.caregiver_name} (
            {currentCaregiver.relationship})
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

        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="font-bold mb-4">간병활동</h2>

          {[
            ["식사보조", mealAssist, setMealAssist],
            ["이동보조", moveAssist, setMoveAssist],
            ["배설보조", toiletAssist, setToiletAssist],
            ["위생관리", hygieneAssist, setHygieneAssist],
            ["체위변경", positionChange, setPositionChange],
          ].map(([label, checked, setter]: any) => (
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
            disabled={locationStatus === "checking"}
            className="w-full bg-blue-600 text-white p-4 rounded-lg font-bold disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {locationStatus === "checking"
              ? "위치 확인 중..."
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