"use client";

import { use, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type LocationStatus = "checking" | "checked" | "unavailable";

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

  const [locationStatus, setLocationStatus] =
    useState<LocationStatus>("checking");

  const [locationMessage, setLocationMessage] = useState(
    "현재 위치를 확인하고 있습니다."
  );

  const [locationFailureReason, setLocationFailureReason] = useState("");
  const [locationCheckedAt, setLocationCheckedAt] = useState<string | null>(
    null
  );

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [patientName, setPatientName] = useState("");

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
    async function loadPatient() {
      if (!patientId || patientId === "undefined") {
        return;
      }

      const { data } = await supabase
        .from("patients")
        .select("patient_name")
        .eq("patient_id", patientId)
        .single();

      if (data) {
        setPatientName(data.patient_name);
      }
    }

    loadPatient();
    checkLocation();
  }, [patientId, checkLocation]);

  async function handleSave() {
    setMessage("");

    if (!patientId || patientId === "undefined") {
      setMessage("잘못된 접근입니다. 환자를 다시 선택해주세요.");
      return;
    }

    if (!relationship) {
      setMessage("환자와의 관계를 선택해주세요.");
      return;
    }

    if (!signatureName.trim()) {
      setMessage("전자서명을 입력해주세요.");
      return;
    }

    if (locationStatus === "checking") {
      setMessage("위치 확인이 끝날 때까지 잠시 기다려주세요.");
      return;
    }

    setMessage("저장 중입니다...");

    const today = new Date().toISOString().slice(0, 10);

    const { data: existingLogs, error: checkError } = await supabase
      .from("care_logs")
      .select("log_id")
      .eq("patient_id", patientId)
      .eq("care_date", today);

    if (checkError) {
      setMessage("기존 기록 확인 실패: " + checkError.message);
      return;
    }

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
        signature_name: signatureName.trim(),
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
      })
      .select()
      .single();

    if (error) {
      setMessage("저장 실패: " + error.message);
      return;
    }

    if (photoFile && savedLog) {
      const safeFileName = photoFile.name.replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      );

      const filePath = `${savedLog.log_id}/${Date.now()}-${safeFileName}`;

      const { error: uploadError } = await supabase.storage
        .from("care-log-photos")
        .upload(filePath, photoFile);

      if (uploadError) {
        setMessage(
          "간병일지는 저장됐지만 사진 업로드에 실패했습니다: " +
            uploadError.message
        );
        return;
      }

      const { error: photoRecordError } = await supabase
        .from("care_log_photos")
        .insert({
          log_id: savedLog.log_id,
          file_url: filePath,
        });

      if (photoRecordError) {
        setMessage(
          "사진은 업로드됐지만 사진 정보 저장에 실패했습니다: " +
            photoRecordError.message
        );
        return;
      }
    }

    setMessage(
      "간병일지가 저장되었습니다. 작성기록 화면으로 이동합니다."
    );

    setTimeout(() => {
      window.location.href = `/patients/${patientId}/care-logs`;
    }, 1500);
  }

  if (!patientId || patientId === "undefined") {
    return (
      <main className="p-8">
        잘못된 접근입니다. 환자 목록에서 다시 선택해주세요.
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto space-y-4">
        <div className="bg-white p-5 rounded-lg shadow">
          <h1 className="text-2xl font-bold">간병일지 작성</h1>

          <p className="text-gray-600 mt-2">
            환자명: {patientName || "-"}
          </p>
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
                onChange={(event) => setter(event.target.checked)}
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
            onChange={(event) => setMemo(event.target.value)}
          />
        </div>

        <div className="bg-white p-5 rounded-lg shadow">
          <h2 className="font-bold mb-4">작성자 정보</h2>

          <select
            className="w-full border p-3 rounded mb-3"
            value={relationship}
            onChange={(event) => setRelationship(event.target.value)}
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
            onChange={(event) => setSignatureName(event.target.value)}
          />
        </div>

        <div className="bg-white p-5 rounded-lg shadow">
          <h2 className="font-bold mb-4">증빙자료</h2>

          <div className="mb-4 rounded border bg-gray-50 p-3">
            <p className="text-sm text-gray-700">
              간병일지 작성 시 위치 확인을 자동으로 진행합니다.
              위치 확인이 불가능한 경우에만 미기록 사유가 저장됩니다.
            </p>
          </div>

          <div className="mb-4 rounded border p-3">
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
                <p className="mt-1 text-xs text-red-600">
                  미기록 사유: {locationFailureReason}
                </p>
              )}
          </div>

          <button
            type="button"
            onClick={checkLocation}
            disabled={locationStatus === "checking"}
            className="w-full border border-blue-600 text-blue-600 p-3 rounded mb-4 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {locationStatus === "checking"
              ? "위치 확인 중..."
              : "현재 위치 다시 확인"}
          </button>

          <label className="block text-sm font-bold mb-2">
            사진 첨부
          </label>

          <input
            type="file"
            accept="image/*"
            className="w-full border p-3 rounded"
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              setPhotoFile(file);
            }}
          />

          {photoFile && (
            <p className="mt-2 text-sm text-gray-600">
              선택된 파일: {photoFile.name}
            </p>
          )}
        </div>

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

        {message && (
          <p className="text-center text-sm pb-8">
            {message}
          </p>
        )}
      </div>
    </main>
  );
}