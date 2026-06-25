"use client";

import { use, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function CareLogPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const patientId = id;

  const [mealAssist, setMealAssist] = useState(false);
  const [moveAssist, setMoveAssist] = useState(false);
  const [toiletAssist, setToiletAssist] = useState(false);
  const [hygieneAssist, setHygieneAssist] = useState(false);
  const [positionChange, setPositionChange] = useState(false);
  const [memo, setMemo] = useState("");
  const [relationship, setRelationship] = useState("");
  const [signatureName, setSignatureName] = useState("");
  const [message, setMessage] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [locationMessage, setLocationMessage] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [patientName, setPatientName] = useState("");

  if (!patientId || patientId === "undefined") {
    return <main className="p-8">잘못된 접근입니다.</main>;
  }

  useEffect(() => {
    async function loadPatient() {
      const { data } = await supabase
        .from("patients")
        .select("patient_name")
        .eq("patient_id", patientId)
        .single();

      if (data) setPatientName(data.patient_name);
    }

    loadPatient();
  }, [patientId]);

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
    setMessage("저장 중입니다...");

    if (!relationship) {
      setMessage("환자와의 관계를 선택해주세요.");
      return;
    }

    if (!signatureName) {
      setMessage("전자서명을 입력해주세요.");
      return;
    }

    const today = new Date().toISOString().slice(0, 10);

    const { data: existingLogs } = await supabase
      .from("care_logs")
      .select("log_id")
      .eq("patient_id", patientId)
      .eq("care_date", today);

    if (existingLogs && existingLogs.length > 0) {
      setMessage("오늘은 이미 작성된 간병일지가 있습니다.");
      return;
    }

    const { data: savedLog, error } = await supabase
      .from("care_logs")
      .insert({
        patient_id: patientId,
        care_date: today,
        meal_assist: mealAssist,
        move_assist: moveAssist,
        toilet_assist: toiletAssist,
        hygiene_assist: hygieneAssist,
        position_change: positionChange,
        memo,
        relationship,
        signature_name: signatureName,
        hospital_confirmed: true,
        latitude,
        longitude,
        location_checked_at: latitude && longitude ? new Date().toISOString() : null,
        location_status: latitude && longitude ? "checked" : "not_used",
      })
      .select()
      .single();

    if (error) {
      setMessage("저장 실패: " + error.message);
      return;
    }

    if (photoFile && savedLog) {
      const filePath = `${savedLog.log_id}/${Date.now()}-${photoFile.name}`;

      const { error: uploadError } = await supabase.storage
        .from("care-log-photos")
        .upload(filePath, photoFile);

      if (uploadError) {
        setMessage("간병일지는 저장됐지만 사진 업로드 실패: " + uploadError.message);
        return;
      }

      await supabase.from("care_log_photos").insert({
        log_id: savedLog.log_id,
        file_url: filePath,
      });
    }

    setMessage("간병일지가 저장되었습니다. 작성기록 화면으로 이동합니다.");

    setTimeout(() => {
      window.location.href = `/patients/${patientId}/care-logs`;
    }, 1500);
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto space-y-4">
        <div className="bg-white p-5 rounded-lg shadow">
          <h1 className="text-2xl font-bold">간병일지 작성</h1>
          <p className="text-gray-600 mt-2">환자명: {patientName || "-"}</p>
        </div>

        <div className="bg-white p-5 rounded-lg shadow">
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
                onChange={(e) => setter(e.target.checked)}
              />
            </label>
          ))}
        </div>

        <div className="bg-white p-5 rounded-lg shadow">
          <h2 className="font-bold mb-4">특이사항</h2>

          <textarea
            className="w-full border p-3 rounded"
            placeholder="예: 식사 보조, 화장실 이동 보조 등"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>

        <div className="bg-white p-5 rounded-lg shadow">
          <h2 className="font-bold mb-4">작성자 정보</h2>

          <select
            className="w-full border p-3 rounded mb-3"
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
          >
            <option value="">환자와의 관계 선택</option>
            <option value="배우자">배우자</option>
            <option value="부모">부모</option>
            <option value="자녀">자녀</option>
            <option value="형제자매">형제자매</option>
            <option value="지인">지인</option>
            <option value="기타">기타</option>
          </select>

          <input
            className="w-full border p-3 rounded"
            placeholder="전자서명: 작성자 성명"
            value={signatureName}
            onChange={(e) => setSignatureName(e.target.value)}
          />
        </div>

        <div className="bg-white p-5 rounded-lg shadow">
          <h2 className="font-bold mb-4">선택 증빙자료</h2>

          <input
            type="file"
            accept="image/*"
            className="w-full border p-3 rounded mb-3"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setPhotoFile(file);
            }}
          />

          <button
            type="button"
            onClick={handleLocationCheck}
            className="w-full border border-blue-600 text-blue-600 p-3 rounded"
          >
            현재 위치 확인
          </button>

          {locationMessage && (
            <p className="mt-3 text-center text-sm text-gray-600">
              {locationMessage}
            </p>
          )}
        </div>

        <button
          onClick={handleSave}
          className="w-full bg-blue-600 text-white p-4 rounded-lg font-bold"
        >
          저장하기
        </button>

        {message && (
          <p className="text-center text-sm pb-8">
            {message}
          </p>
        )}
      </div>
    </main>
  );
}