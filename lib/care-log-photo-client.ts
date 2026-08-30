import {
  PHOTO_JPEG_QUALITY,
  PHOTO_MAX_DIMENSION,
} from "@/lib/care-log-photo";

/**
 * 브라우저에서만 쓰는 사진 처리. canvas/document를 쓰므로 클라이언트
 * 컴포넌트에서만 import한다(정책 상수와 순수 함수는
 * lib/care-log-photo.ts에 있다).
 *
 * 일지를 새로 쓸 때(app/case-care-log/[id]/CareLogClient.tsx)와 작성 후
 * 정정할 때(app/cases/[id]/care-logs/CareLogEditor.tsx)가 같은 압축을
 * 거치도록 여기 한 곳에 둔다.
 */

/**
 * 업로드 전에 사진을 줄인다. 요즘 폰 원본은 3~8MB라 그대로 올리면 실패가
 * 잦고, canvas로 다시 그려 내보내면 EXIF(촬영 위치 등)가 함께 사라져
 * 개인정보 측면에서도 유리하다. 압축에 실패하면 원본을 그대로 쓴다 —
 * 서버가 형식/용량을 다시 검증하므로 안전하다.
 */
export async function compressPhoto(file: File): Promise<File> {
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
