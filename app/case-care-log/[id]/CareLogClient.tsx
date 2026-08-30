"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  MAX_PHOTO_BYTES,
  PHOTO_JPEG_QUALITY,
  PHOTO_MAX_DIMENSION,
  isAllowedPhotoMimeType,
} from "@/lib/care-log-photo";

/**
 * idle = 위치 확인을 아직 시작하지 않은 상태.
 *   - 최초 질문에 답하기 전(동의 미결정)
 *   - 또는 위치정보 사용에 동의하지 않아 앞으로도 확인하지 않는 상태
 * 어느 쪽이든 navigator.geolocation을 호출하지 않는다.
 */
type LocationStatus = "idle" | "checking" | "checked" | "unavailable";

/** 위치정보 사용에 동의하지 않은 채 저장할 때 남기는 미기록 사유. */
const CONSENT_DECLINED_REASON = "consent_declined";

/**
 * 업로드 전에 사진을 줄인다. 요즘 폰 원본은 3~8MB라 그대로 올리면 실패가
 * 잦고, canvas로 다시 그려 내보내면 EXIF(촬영 위치 등)가 함께 사라져
 * 개인정보 측면에서도 유리하다. 압축에 실패하면 원본을 그대로 쓴다 —
 * 서버가 형식/용량을 다시 검증하므로 안전하다.
 */
async function compressPhoto(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(
      1,
      PHOTO_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height)
    );

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const context = canvas.getContext("2d");

    if (!context) {
      return file;
    }

    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", PHOTO_JPEG_QUALITY)
    );

    if (!blob) {
      return file;
    }

    return new File([blob], "photo.jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

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
  locationConsent,
  currentCaregiverChange,
}: {
  caseId: string;
  patientName: string;
  currentCaregiverName: string | null;
  currentCaregiverRelationship: string | null;
  caregiverStatus: CaregiverStatus;
  /**
   * 이 사례에서 이 간병인의 위치정보 동의 상태(case_caregivers 행 값).
   * null이면 아직 한 번도 답하지 않은 것이라 최초 질문을 띄운다.
   */
  locationConsent: boolean | null;
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

  // 첨부 사진(선택). 일지 저장 후 그 log_id로 업로드하므로, 저장 전까지는
  // 화면에만 들고 있는다.
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState("");

  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);

  // 동의 여부에 따라 시작 상태가 다르다.
  //   동의함(true)  -> 아래 useEffect가 바로 위치 확인을 시작한다
  //   거부함(false) -> 확인하지 않고 미기록 사유와 함께 저장한다
  //   미결정(null)  -> 질문에 답하기 전까지 아무것도 하지 않는다
  const [locationStatus, setLocationStatus] = useState<LocationStatus>(
    locationConsent === true ? "checking" : "idle"
  );

  const [locationMessage, setLocationMessage] = useState(
    locationConsent === true
      ? "현재 위치를 확인하고 있습니다."
      : locationConsent === false
        ? "위치정보를 사용하지 않기로 선택하셨습니다. 위치 없이 작성할 수 있습니다."
        : ""
  );

  // 이 화면에서 방금 선택한 값. null이면 아직 답하지 않았다는 뜻이라
  // 질문을 계속 보여준다(서버에서 받은 초기값을 출발점으로 쓴다).
  const [consent, setConsent] = useState<boolean | null>(locationConsent);
  const [savingConsent, setSavingConsent] = useState(false);

  const [locationFailureReason, setLocationFailureReason] = useState(
    locationConsent === false ? CONSENT_DECLINED_REASON : ""
  );
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
    // 이미 위치정보 사용에 동의한 간병인만 화면 진입 시 자동으로 확인한다.
    // 아직 답하지 않았거나(null) 거부한(false) 경우에는 navigator.geolocation을
    // 호출하지 않는다 — 동의 전에 브라우저 권한 팝업이 먼저 뜨지 않게 하는
    // 것이 이 기능의 핵심이다.
    if (locationConsent !== true) {
      return;
    }

    // checkLocation의 setState 호출은 모두 navigator.geolocation의 비동기
    // 콜백 안에서 일어나므로 이 규칙이 우려하는 "effect 본문에서의 동기
    // setState"에 해당하지 않는다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkLocation();
  }, [checkLocation, locationConsent]);

  /**
   * 최초 1회 질문에 대한 선택을 서버에 기록하고, 동의한 경우에만 위치 확인을
   * 시작한다. 기록에 실패하면 위치 확인을 시작하지 않는다 — 선택이 남지
   * 않은 채 위치만 수집하는 상태를 만들지 않기 위해서다.
   */
  async function handleConsentDecision(agreed: boolean) {
    if (savingConsent) {
      return;
    }

    setSavingConsent(true);
    setMessage("");

    const response = await fetch(`/api/cases/${caseId}/location-consent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consent: agreed }),
    });

    setSavingConsent(false);

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setMessage(body?.error || "동의 정보를 저장하지 못했습니다.");
      return;
    }

    setConsent(agreed);

    if (agreed) {
      checkLocation();
      return;
    }

    setLocationStatus("idle");
    setLocationFailureReason(CONSENT_DECLINED_REASON);
    setLocationCheckedAt(new Date().toISOString());
    setLocationMessage(
      "위치정보를 사용하지 않기로 선택하셨습니다. 위치 없이 작성할 수 있습니다."
    );
  }

  function handlePhotoSelect(file: File | null) {
    setPhotoError("");

    if (photoPreview) {
      URL.revokeObjectURL(photoPreview);
    }

    if (!file) {
      setPhotoFile(null);
      setPhotoPreview(null);
      return;
    }

    // 선택 시점에는 "이미지인가"만 본다. accept이 image/* 라 HEIC 같은
    // 형식도 고를 수 있는데, 그런 파일도 아래 압축 과정에서 브라우저가
    // 디코딩할 수 있으면 JPEG로 바뀌어 정상 업로드된다 — 여기서 형식을
    // 엄격히 막으면 실제로는 올릴 수 있는 사진을 미리 거절하게 된다.
    // 최종 형식 판정은 압축 뒤(uploadPhoto)와 서버가 한다.
    if (!file.type.startsWith("image/")) {
      setPhotoFile(null);
      setPhotoPreview(null);
      setPhotoError("사진 파일만 첨부할 수 있습니다.");
      return;
    }

    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoFile(null);
      setPhotoPreview(null);
      setPhotoError("사진 용량이 너무 큽니다. 다른 사진을 선택해주세요.");
      return;
    }

    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  /**
   * 일지 저장이 끝난 뒤에 사진을 올린다. 업로드가 실패해도 일지 자체는
   * 이미 저장된 상태이므로 되돌리지 않는다 — 사진은 선택사항이고, 본문을
   * 잃는 것이 더 큰 손실이다. 실패 사실만 사용자에게 알린다.
   */
  async function uploadPhoto(logId: string): Promise<boolean> {
    if (!photoFile) {
      return true;
    }

    const compressed = await compressPhoto(photoFile);

    // 압축이 성공하면 JPEG가 되고, 실패하면 원본 그대로다. 서버가 거부할
    // 형식이면 요청을 보내기 전에 여기서 알려준다.
    if (!isAllowedPhotoMimeType(compressed.type)) {
      setPhotoError("이 형식의 사진은 첨부할 수 없습니다. 다른 사진을 선택해주세요.");
      return false;
    }

    const form = new FormData();
    form.append("photo", compressed);

    const response = await fetch(
      `/api/cases/${caseId}/care-logs/${logId}/photos`,
      { method: "POST", body: form }
    );

    return response.ok;
  }

  async function handleSave() {
    setMessage("");

    if (locationStatus === "checking") {
      setMessage("위치 확인이 끝날 때까지 잠시 기다려주세요.");
      return;
    }

    if (consent === null) {
      setMessage("위치정보 사용 여부를 먼저 선택해주세요.");
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
        // idle은 "동의하지 않아 확인하지 않음"이다 — 서버 계약상
        // location_status는 checked/unavailable 둘뿐이므로 unavailable로
        // 보내고, 사유로 그 이유를 구분한다.
        location_failure_reason:
          locationStatus === "checked"
            ? null
            : locationFailureReason ||
              (locationStatus === "idle"
                ? CONSENT_DECLINED_REASON
                : "unknown_error"),
      }),
    });

    setSaving(false);

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setMessage(body?.error || "저장에 실패했습니다.");
      return;
    }

    let photoUploaded = true;

    if (photoFile && body?.log_id) {
      setMessage("사진을 첨부하는 중입니다...");
      photoUploaded = await uploadPhoto(body.log_id);
    }

    setMessage(
      photoUploaded
        ? "간병일지가 저장되었습니다. 작성기록 화면으로 이동합니다."
        : "간병일지는 저장됐지만 사진 첨부에 실패했습니다. 작성기록 화면에서 다시 첨부할 수 있습니다."
    );

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

          {consent === null ? (
            <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-4">
              <p className="text-sm font-bold text-gray-900">
                신뢰도 있는 간병일지 작성을 위해 위치정보 수집·이용에
                동의하시겠습니까?
              </p>

              <p className="mt-2 text-xs text-gray-700">
                수집 항목: 위도·경도, 확인 시각 / 이용 목적: 간병일지 작성 위치
                확인. 수집한 위치정보는 해당 간병일지에 기록됩니다. 동의하지
                않아도 간병일지는 작성할 수 있으며, 이 선택은 이 사례에서 한
                번만 여쭤봅니다.
              </p>

              <div className="mt-4 space-y-2">
                <button
                  type="button"
                  onClick={() => handleConsentDecision(true)}
                  disabled={!canWrite || savingConsent}
                  className="w-full bg-blue-600 text-white p-3 rounded font-bold disabled:opacity-50"
                >
                  {savingConsent ? "처리 중..." : "동의하고 위치 확인"}
                </button>

                <button
                  type="button"
                  onClick={() => handleConsentDecision(false)}
                  disabled={!canWrite || savingConsent}
                  className="w-full border border-gray-400 text-gray-700 p-3 rounded disabled:opacity-50"
                >
                  동의하지 않고 작성
                </button>
              </div>
            </div>
          ) : (
            <p className="mb-4 text-sm text-gray-600">
              {consent
                ? "간병일지 작성 시 위치 확인을 시도합니다. 위치를 확인할 수 없는 경우에만 미기록 사유가 저장됩니다."
                : "위치정보를 사용하지 않기로 선택하셨습니다. 위치 없이 간병일지를 작성할 수 있습니다."}
            </p>
          )}

          <div className="mb-4 rounded border bg-gray-50 p-3">
            <p className="text-sm font-bold">
              위치 상태:{" "}
              {locationStatus === "checking"
                ? "확인 중"
                : locationStatus === "checked"
                  ? "확인 완료"
                  : locationStatus === "idle"
                    ? consent === null
                      ? "선택 대기"
                      : "사용 안 함"
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

          {/* 위치 재확인은 동의한 간병인에게만 의미가 있다. 거부했거나 아직
              답하지 않았으면 이 버튼이 geolocation을 부르면 안 되므로 숨긴다. */}
          <button
            type="button"
            onClick={checkLocation}
            hidden={consent !== true}
            disabled={!canWrite || locationStatus === "checking" || consent !== true}
            className="w-full border border-blue-600 text-blue-600 p-3 rounded disabled:cursor-not-allowed disabled:opacity-50"
          >
            {locationStatus === "checking"
              ? "위치 확인 중..."
              : "현재 위치 다시 확인"}
          </button>
        </div>

        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="font-bold mb-2">사진 첨부 (선택)</h2>

          <p className="mb-4 text-sm text-gray-600">
            간병 현장 사진을 1장 첨부할 수 있습니다. 첨부하지 않아도 일지는
            저장됩니다.
          </p>

          {/* 기본 <input type="file">은 브라우저마다 "파일 선택 / 선택된 파일
              없음" 같은 제각각의 모양으로 그려져 버튼으로 보이지 않는다.
              입력 자체는 화면에서 숨기고(sr-only — 접근성 도구와 키보드에는
              그대로 노출된다) 같은 화면의 다른 버튼과 같은 모양의 label로
              누르게 한다.

              accept은 구체적인 MIME 목록이 아니라 image/* 로 둔다. 목록을
              나열하면 안드로이드(삼성 인터넷 등)가 인텐트를 제대로 매칭하지
              못해 갤러리 대신 카메라/캠코더만 뜨는 일이 생긴다. image/* 는
              표준적으로 처리되어 갤러리가 정상적으로 나온다. 실제 형식
              제한은 아래 선택 시점과 서버가 각각 검사한다.

              capture 속성은 넣지 않는다 — 넣으면 카메라가 곧바로 열려
              앨범에서 고르는 길이 막힌다. */}
          <input
            id="care-log-photo-input"
            type="file"
            accept="image/*"
            disabled={!canWrite || saving}
            onChange={(event) =>
              handlePhotoSelect(event.target.files?.[0] ?? null)
            }
            className="sr-only"
          />

          <label
            htmlFor="care-log-photo-input"
            aria-disabled={!canWrite || saving}
            className={
              "block w-full border border-blue-600 text-blue-600 p-3 rounded text-center font-bold min-h-[44px] " +
              (!canWrite || saving
                ? "pointer-events-none opacity-50"
                : "cursor-pointer")
            }
          >
            {photoFile ? "다른 사진 선택" : "사진 선택"}
          </label>

          {photoError && (
            <p className="mt-2 text-sm text-red-600">{photoError}</p>
          )}

          {photoPreview && (
            <div className="mt-3">
              {/* 로컬 미리보기(blob URL)라 next/image 최적화 대상이 아니다. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoPreview}
                alt="첨부할 사진 미리보기"
                className="w-full max-h-64 object-contain rounded border"
              />

              <button
                type="button"
                onClick={() => handlePhotoSelect(null)}
                disabled={saving}
                className="mt-2 w-full border border-gray-400 text-gray-700 p-2 rounded text-sm disabled:opacity-50"
              >
                사진 선택 취소
              </button>
            </div>
          )}
        </div>

        {canWrite ? (
          <button
            type="button"
            onClick={handleSave}
            disabled={locationStatus === "checking" || saving || consent === null}
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
