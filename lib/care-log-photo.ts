/**
 * 간병일지 첨부 사진 정책 한 곳.
 *
 * 화면(app/case-care-log/[id]/CareLogClient.tsx)과 서버
 * (app/api/cases/[id]/care-logs/[logId]/photos/route.ts)가 같은 기준을 쓰도록
 * 상수와 순수 함수를 여기 모은다. 화면 검증은 사용자 편의를 위한 것이고
 * 실제 방어는 서버가 한다 — 두 곳의 값이 갈리면 "화면은 통과했는데 서버가
 * 거부"하는 혼란이 생기므로 반드시 이 파일만 참조한다.
 */

/** 저장용 Storage 버킷. private이며 signed URL로만 읽는다. */
export const CARE_LOG_PHOTO_BUCKET = "care-log-photos";

/**
 * 일지 1건당 첨부할 수 있는 사진 수.
 *
 * 1장으로 제한한 이유: 일지마다 1장이면 여러 장 선택/부분 실패/장수 카운트
 * 같은 복잡도가 전부 사라지고, 출력물에서도 "일지 1건 = 사진 1장"이라
 * 사진마다 간병일자를 그대로 붙일 수 있다.
 */
export const MAX_PHOTOS_PER_LOG = 1;

/**
 * 업로드 허용 형식. 동영상·GIF·실행 파일을 차단하는 것이 목적이다 —
 * 앨범에서 실수로 동영상을 고르는 일이 흔하다.
 *
 * Storage 버킷의 allowed_mime_types와 같은 값으로 맞춘다(운영 설정,
 * docs 참고). 한쪽만 바꾸면 "서버는 통과시켰는데 Storage가 거부"하는
 * 원인 찾기 어려운 실패가 난다.
 */
export const ALLOWED_PHOTO_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

/**
 * 장당 최대 바이트(10MB).
 *
 * 사용자를 제약하려는 값이 아니라 안전 상한이다 — 화면에서 압축을 거치면
 * 보통 200~500KB가 되므로 정상 사진이 여기 걸릴 일은 없다. 압축이 실패한
 * 기기에서 원본이 통째로 올라오는 사고만 막는다.
 * Storage 버킷의 file_size_limit과 같은 값으로 맞춘다.
 */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** 화면에서 압축할 때 목표로 하는 긴 변 길이(px). */
export const PHOTO_MAX_DIMENSION = 1600;

/** 압축 JPEG 품질. */
export const PHOTO_JPEG_QUALITY = 0.8;

/**
 * 작성 후 이 시간 안에서만 사진을 추가/삭제할 수 있다.
 *
 * 잘못 올린 사진을 되돌릴 수 없으면 곤란하므로 짧은 정정 창을 둔다. 판정은
 * 반드시 서버에서 한다 — 클라이언트 시계는 신뢰할 수 없다.
 */
export const PHOTO_EDIT_WINDOW_MS = 60 * 60 * 1000;

export type AllowedPhotoMimeType = (typeof ALLOWED_PHOTO_MIME_TYPES)[number];

export function isAllowedPhotoMimeType(value: string): value is AllowedPhotoMimeType {
  return (ALLOWED_PHOTO_MIME_TYPES as readonly string[]).includes(value);
}

/** MIME 타입에 대응하는 저장 확장자. 원본 파일명은 쓰지 않는다. */
export function photoExtensionFor(mimeType: AllowedPhotoMimeType): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

/**
 * 아직 사진을 추가/삭제할 수 있는 시점인지 판단한다.
 *
 * createdAt을 읽을 수 없으면 false를 돌려준다(fail-closed) — 기준 시각을
 * 모르는 채로 증빙 기록을 바꾸게 두지 않는다.
 */
export function isWithinPhotoEditWindow(
  createdAt: string | null | undefined,
  now: number = Date.now()
): boolean {
  if (!createdAt) {
    return false;
  }

  const created = new Date(createdAt).getTime();

  if (Number.isNaN(created)) {
    return false;
  }

  return now - created < PHOTO_EDIT_WINDOW_MS;
}

/**
 * Storage 객체 경로. `{log_id}/{uuid}.{ext}` 형태다.
 *
 * 원본 파일명을 쓰지 않는 이유: 파일명에 환자명 등 개인정보가 섞여 들어올
 * 수 있다. 첫 폴더를 log_id로 두는 규칙은 기존 Storage RLS 정책이
 * storage.foldername(name)[1]로 대조하는 형태와 일치시킨 것이다
 * (supabase/migrations/20260803120500_rls_policies.sql).
 */
export function buildPhotoStoragePath(
  logId: string,
  fileId: string,
  mimeType: AllowedPhotoMimeType
): string {
  return `${logId}/${fileId}.${photoExtensionFor(mimeType)}`;
}
