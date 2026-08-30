"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_PHOTO_BYTES, isAllowedPhotoMimeType } from "@/lib/care-log-photo";
import { compressPhoto } from "@/lib/care-log-photo-client";

/**
 * 작성 후 짧은 창 안에서 자기 간병일지를 정정하는 영역.
 *
 * 평소에는 "수정" 버튼 하나만 보이고, 누르면 그 자리에서 간병활동과
 * 특이사항을 고칠 수 있다. 사진 추가/삭제도 같은 창 안에서 한다.
 *
 * 위치정보와 간병일자는 여기서 다루지 않는다 — 그 값들은 작성 시점에
 * 측정된 사실이라 나중에 바꿀 수 있으면 기록의 의미가 사라진다.
 *
 * 남은 시간 표시는 안내일 뿐이고, 실제 판정은 서버가 created_at으로 한다
 * (클라이언트 시계는 신뢰하지 않는다). 그래서 시간이 지난 뒤 눌러도
 * 서버가 거부하며, 그 메시지를 그대로 보여준다.
 */

const ACTIVITY_LABELS = [
  ["meal_assist", "식사보조"],
  ["move_assist", "이동보조"],
  ["toilet_assist", "배설보조"],
  ["hygiene_assist", "위생관리"],
  ["position_change", "체위변경"],
] as const;

type ActivityKey = (typeof ACTIVITY_LABELS)[number][0];

export type CareLogEditorValues = Record<ActivityKey, boolean> & {
  memo: string;
};

export default function CareLogEditor({
  caseId,
  logId,
  initialValues,
  hasPhoto,
  editableUntil,
}: {
  caseId: string;
  logId: string;
  initialValues: CareLogEditorValues;
  hasPhoto: boolean;
  /** 서버가 계산한 정정 마감 시각(ISO). 남은 시간 안내에만 쓴다. */
  editableUntil: string;
}) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<CareLogEditorValues>(initialValues);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  // 서버 렌더 시각과 브라우저 시각이 달라 hydration이 어긋나지 않도록,
  // 남은 시간은 마운트 후에만 계산한다(첫 렌더에서는 표시하지 않는다).
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    const deadline = new Date(editableUntil).getTime();

    if (Number.isNaN(deadline)) {
      return;
    }

    const tick = () => setRemainingMs(deadline - Date.now());

    tick();

    const timer = setInterval(tick, 30_000);

    return () => clearInterval(timer);
  }, [editableUntil]);

  // 미리보기 blob URL은 컴포넌트가 사라질 때 정리한다.
  useEffect(() => {
    return () => {
      if (photoPreview) {
        URL.revokeObjectURL(photoPreview);
      }
    };
  }, [photoPreview]);

  // 시간이 다 되면 화면에서도 조용히 사라진다. 서버는 어차피 거부하므로
  // 누를 수 있게 남겨 둘 이유가 없다.
  if (remainingMs !== null && remainingMs <= 0) {
    return null;
  }

  const remainingMinutes =
    remainingMs === null ? null : Math.max(1, Math.ceil(remainingMs / 60_000));

  function selectPhoto(file: File | null) {
    setMessage("");

    if (photoPreview) {
      URL.revokeObjectURL(photoPreview);
    }

    if (!file) {
      setPhotoFile(null);
      setPhotoPreview(null);
      return;
    }

    // 선택 시점에는 "이미지인가"만 본다(작성 화면과 같은 기준). 최종 형식
    // 판정은 압축 뒤와 서버가 한다.
    if (!file.type.startsWith("image/")) {
      setPhotoFile(null);
      setPhotoPreview(null);
      setMessage("사진 파일만 첨부할 수 있습니다.");
      return;
    }

    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoFile(null);
      setPhotoPreview(null);
      setMessage("사진 용량이 너무 큽니다. 다른 사진을 선택해주세요.");
      return;
    }

    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function handleSave() {
    setSaving(true);
    setMessage("");

    try {
      const response = await fetch(`/api/cases/${caseId}/care-logs/${logId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setMessage(body?.error || "간병일지 수정에 실패했습니다.");
        return;
      }

      // 본문 저장이 끝난 뒤에 사진을 올린다. 사진 업로드가 실패해도 이미
      // 저장된 본문은 되돌리지 않는다 — 사진은 선택사항이다.
      if (photoFile) {
        const uploaded = await uploadPhoto();

        if (!uploaded) {
          router.refresh();
          return;
        }
      }

      setOpen(false);
      setPhotoFile(null);
      setPhotoPreview(null);
      setMessage("수정되었습니다.");
      router.refresh();
    } catch {
      setMessage("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadPhoto(): Promise<boolean> {
    if (!photoFile) {
      return true;
    }

    const compressed = await compressPhoto(photoFile);

    if (!isAllowedPhotoMimeType(compressed.type)) {
      setMessage("이 형식의 사진은 첨부할 수 없습니다. 다른 사진을 선택해주세요.");
      return false;
    }

    const form = new FormData();
    form.append("photo", compressed);

    const response = await fetch(
      `/api/cases/${caseId}/care-logs/${logId}/photos`,
      { method: "POST", body: form }
    );

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setMessage(body?.error || "사진을 첨부하지 못했습니다.");
      return false;
    }

    return true;
  }

  async function handleDeletePhoto() {
    if (!window.confirm("첨부된 사진을 삭제할까요?")) {
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/cases/${caseId}/care-logs/${logId}/photos`,
        { method: "DELETE" }
      );

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setMessage(body?.error || "사진을 삭제하지 못했습니다.");
        return;
      }

      setMessage("사진이 삭제되었습니다.");
      router.refresh();
    } catch {
      setMessage("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="border-t mt-4 pt-3">
        <button
          type="button"
          onClick={() => {
            setValues(initialValues);
            setMessage("");
            setOpen(true);
          }}
          className="w-full border border-blue-600 text-blue-600 p-3 rounded font-bold min-h-[44px]"
        >
          이 일지 수정
        </button>

        <p className="mt-2 text-xs text-gray-600">
          작성 후 1시간 안에는 간병활동·특이사항·사진을 고칠 수 있습니다.
          {remainingMinutes !== null && ` (약 ${remainingMinutes}분 남음)`}
        </p>

        {message && <p className="mt-2 text-sm text-blue-700">{message}</p>}
      </div>
    );
  }

  const photoInputId = `care-log-edit-photo-${logId}`;

  return (
    <div className="border-t mt-4 pt-3">
      <p className="font-bold text-sm mb-2">일지 수정</p>

      <div className="space-y-2 mb-3">
        {ACTIVITY_LABELS.map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values[key]}
              disabled={saving}
              onChange={(event) =>
                setValues((prev) => ({ ...prev, [key]: event.target.checked }))
              }
              className="w-5 h-5"
            />
            {label}
          </label>
        ))}
      </div>

      <label className="block text-sm mb-1" htmlFor={`care-log-edit-memo-${logId}`}>
        특이사항
      </label>

      <textarea
        id={`care-log-edit-memo-${logId}`}
        value={values.memo}
        disabled={saving}
        onChange={(event) =>
          setValues((prev) => ({ ...prev, memo: event.target.value }))
        }
        rows={3}
        className="w-full border rounded p-2 text-sm"
      />

      {/* 사진. 일지 1건당 1장이라 이미 있으면 삭제만, 없으면 추가만 한다.
          교체는 "삭제 후 다시 추가"다. 작성 화면과 같은 이유로 파일 입력은
          숨기고 label을 버튼처럼 쓴다(accept은 image/*, capture 없음). */}
      <div className="mt-3">
        {hasPhoto ? (
          <button
            type="button"
            onClick={handleDeletePhoto}
            disabled={saving}
            className="w-full border border-red-600 text-red-600 p-3 rounded font-bold min-h-[44px] disabled:opacity-50"
          >
            첨부 사진 삭제
          </button>
        ) : (
          <>
            <input
              id={photoInputId}
              type="file"
              accept="image/*"
              disabled={saving}
              onChange={(event) => selectPhoto(event.target.files?.[0] ?? null)}
              className="sr-only"
            />

            <label
              htmlFor={photoInputId}
              aria-disabled={saving}
              className={
                "block w-full border border-blue-600 text-blue-600 p-3 rounded text-center font-bold min-h-[44px] " +
                (saving ? "pointer-events-none opacity-50" : "cursor-pointer")
              }
            >
              {photoFile ? "다른 사진 선택" : "사진 선택"}
            </label>

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
                  onClick={() => selectPhoto(null)}
                  disabled={saving}
                  className="mt-2 w-full border border-gray-400 text-gray-700 p-2 rounded text-sm disabled:opacity-50"
                >
                  사진 선택 취소
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {message && <p className="mt-3 text-sm text-red-600">{message}</p>}

      <div className="grid grid-cols-2 gap-2 mt-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 text-white p-3 rounded font-bold disabled:bg-gray-400"
        >
          {saving ? "저장 중..." : "수정 저장"}
        </button>

        <button
          type="button"
          onClick={() => {
            selectPhoto(null);
            setValues(initialValues);
            setMessage("");
            setOpen(false);
          }}
          disabled={saving}
          className="border border-gray-400 text-gray-700 p-3 rounded disabled:opacity-50"
        >
          취소
        </button>
      </div>
    </div>
  );
}
