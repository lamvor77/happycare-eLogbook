"use client";

import { use, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

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
  const [locationMessage, setLocationMessage] = useState("");

  useEffect(() => {
    const savedCaregiverId = localStorage.getItem("caregiver_id");
    if (savedCaregiverId) setLoginCaregiverId(savedCaregiverId);

    async function loadCase() {
      const { data } = await supabase
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

      setCaseData(data || null);

      const current = data?.case_caregivers?.find(
        (item: any) => item.is_current_caregiver
      );

      setCurrentCaregiver(current || null);
    }

    loadCase();
  }, [caseId]);

  const canWrite =
    loginCaregiverId &&
    currentCaregiver?.caregiver_id === loginCaregiverId;

  function handleLocationCheck() {
    setLocationMessage("위치 확인 중입니다...");

    if (!navigator.geolocation) {
      setLocationMessage("이 브라우저에서는 위치 확인을 지원하지 않습니다.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude);
        setLongitude(position.coords.longitude);
        setLocationMessage("위치 확인이 완료되었습니다.");
      },
      () => {
        setLocationMessage("위치 확인에 실패했습니다. 선택사항이므로 저장은 가능합니다.");
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  }

  async function handleSave() {
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

    const { data: existingLogs } = await supabase
      .from("care_logs")
      .select("log_id")
      .eq("case_id", caseId)
      .eq("care_date", today);

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
      latitude,
      longitude,
      location_checked_at: latitude && longitude ? new Date().toISOString() : null,
      location_status: latitude && longitude ? "checked" : "not_used",
    });

    if (error) {
      setMessage("저장 실패: " + error.message);
      return;
    }

    setMessage("간병일지가 저장되었습니다.");

    setTimeout(() => {
      window.location.href = `/cases/${caseId}/care-logs`;
    }, 1200);
  }

  if (!caseData) {
    return <main className="p-8">사례 정보를 불러오는 중입니다.</main>;
  }

  if (!currentCaregiver) {
    return <main className="p-8">현재 간병인이 지정되어 있지 않습니다.</main>;
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto space-y-4">
        <div className="bg-white rounded-lg shadow p-5">
          <h1 className="text-2xl font-bold">간병일지 작성</h1>
          <p className="text-gray-600 mt-2">환자명: {caseData.patient_name}</p>
          <p className="text-gray-600">
            현재 간병인: {currentCaregiver.caregivers?.caregiver_name} ({currentCaregiver.relationship})
          </p>

          {!canWrite && (
            <div className="mt-4 bg-red-50 text-red-600 p-3 rounded text-sm">
              현재 간병인으로 로그인한 경우에만 작성할 수 있습니다.
              <br />
              <a href="/caregiver-login" className="underline font-bold">
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
            <label key={label} className="flex items-center justify-between border rounded p-3 mb-2">
              <span>{label}</span>
              <input
                type="checkbox"
                checked={checked}
                disabled={!canWrite}
                onChange={(e) => setter(e.target.checked)}
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
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>

        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="font-bold mb-4">선택 증빙자료</h2>

          <button
            type="button"
            onClick={handleLocationCheck}
            disabled={!canWrite}
            className="w-full border border-blue-600 text-blue-600 p-3 rounded disabled:opacity-50"
          >
            현재 위치 확인
          </button>

          {locationMessage && (
            <p className="mt-3 text-center text-sm text-gray-600">
              {locationMessage}
            </p>
          )}
        </div>

        {canWrite ? (
          <button
            onClick={handleSave}
            className="w-full bg-blue-600 text-white p-4 rounded-lg font-bold"
          >
            저장하기
          </button>
        ) : (
          <a
            href="/caregiver-login"
            className="block text-center bg-gray-700 text-white p-4 rounded-lg font-bold"
          >
            간병인 로그인
          </a>
        )}

        {message && <p className="text-center text-sm pb-8">{message}</p>}
      </div>
    </main>
  );
}