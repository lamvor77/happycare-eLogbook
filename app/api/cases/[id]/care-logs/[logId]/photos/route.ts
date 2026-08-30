import { NextResponse } from "next/server";
import { CaregiverAuthError, requireCurrentCaregiverSession } from "@/lib/caregiver-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isSameOriginRequest, sameOriginErrorResponse } from "@/lib/request-guard";
import {
  CARE_LOG_PHOTO_BUCKET,
  MAX_PHOTOS_PER_LOG,
  MAX_PHOTO_BYTES,
  buildPhotoStoragePath,
  isAllowedPhotoMimeType,
  isWithinPhotoEditWindow,
} from "@/lib/care-log-photo";

/**
 * 간병일지 첨부 사진 추가/삭제.
 *
 * 사진은 선택사항이고 일지 1건당 1장이다. 잘못 올린 사진을 되돌릴 수
 * 있어야 하므로 작성 후 짧은 정정 창(lib/care-log-photo.ts의
 * PHOTO_EDIT_WINDOW_MS) 안에서만 추가/삭제를 허용한다. 교체는 삭제 후
 * 다시 추가하는 것으로 처리한다.
 *
 * *** 권한 ***
 * 간병일지 작성과 같은 조건을 요구한다(로그인 + 이 사례의 현재 간병인 본인
 * + 사례 진행 중). 거기에 더해 "그 일지를 쓴 본인인지"를 다시 확인한다 —
 * 현재 간병인이라도 다른 사람이 쓴 일지의 사진을 건드릴 수는 없다.
 *
 * *** RLS와 service_role ***
 * care_log_photos에는 UPDATE/DELETE 정책이 없고 anon/authenticated에서
 * revoke까지 되어 있다(증빙 성격). 그 설정은 그대로 두고, 이 라우트만
 * service_role로 처리한다 — service_role은 RLS를 우회하므로 정책을 열지
 * 않고도 서버에서 통제된 삭제가 가능하고, 클라이언트 직접 삭제는 계속
 * 차단된 상태로 남는다.
 *
 * *** 개인정보 ***
 * 원본 파일명을 저장하지 않는다(환자명 등이 섞여 들어올 수 있다). 저장
 * 경로는 UUID 기반이고, 버킷은 private이라 URL만으로는 접근할 수 없다.
 * 파일 내용·경로·오류 원문을 로그에 남기지 않는다.
 */

interface LogRow {
  log_id: string;
  case_id: string;
  caregiver_id: string;
  created_at: string | null;
  deleted_at: string | null;
}

/**
 * 이 일지의 사진을 다룰 수 있는지 확인하고, 가능하면 일지 행을 돌려준다.
 * 실패하면 그대로 반환할 응답을 돌려준다.
 */
async function loadEditableLog(
  caseId: string,
  logId: string,
  caregiverId: string
): Promise<{ log: LogRow } | { response: NextResponse }> {
  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("care_logs")
    .select("log_id, case_id, caregiver_id, created_at, deleted_at")
    .eq("log_id", logId)
    .maybeSingle();

  const log = data as LogRow | null;

  // 다른 사례의 일지 id를 넣어도 통하지 않도록 case_id까지 대조한다.
  if (!log || log.case_id !== caseId) {
    return {
      response: NextResponse.json(
        { error: "간병일지를 찾을 수 없습니다." },
        { status: 404 }
      ),
    };
  }

  if (log.deleted_at) {
    return {
      response: NextResponse.json(
        { error: "삭제된 간병일지입니다." },
        { status: 400 }
      ),
    };
  }

  if (log.caregiver_id !== caregiverId) {
    return {
      response: NextResponse.json(
        { error: "본인이 작성한 간병일지만 수정할 수 있습니다." },
        { status: 403 }
      ),
    };
  }

  if (!isWithinPhotoEditWindow(log.created_at)) {
    return {
      response: NextResponse.json(
        { error: "사진을 추가하거나 삭제할 수 있는 시간이 지났습니다." },
        { status: 400 }
      ),
    };
  }

  return { log };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; logId: string }> }
) {
  if (!isSameOriginRequest(request)) {
    return sameOriginErrorResponse();
  }

  const { id: caseId, logId } = await params;

  let auth;

  try {
    auth = await requireCurrentCaregiverSession(caseId);
  } catch (error) {
    if (error instanceof CaregiverAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }

  const guard = await loadEditableLog(caseId, logId, auth.caregiver.caregiver_id);

  if ("response" in guard) {
    return guard.response;
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const file = formData.get("photo");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "사진 파일이 없습니다." }, { status: 400 });
  }

  if (!isAllowedPhotoMimeType(file.type)) {
    return NextResponse.json(
      { error: "JPG, PNG, WebP 형식의 사진만 첨부할 수 있습니다." },
      { status: 400 }
    );
  }

  if (file.size <= 0 || file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json(
      { error: "사진 용량이 너무 큽니다. 다시 시도해주세요." },
      { status: 400 }
    );
  }

  const admin = createSupabaseAdminClient();

  // 일지 1건당 1장이다. 교체하려면 먼저 삭제해야 한다 — 덮어쓰기를 허용하면
  // 이전 파일이 Storage에 남아 고아가 된다.
  const { count: existingCount } = await admin
    .from("care_log_photos")
    .select("*", { count: "exact", head: true })
    .eq("log_id", logId);

  if ((existingCount || 0) >= MAX_PHOTOS_PER_LOG) {
    return NextResponse.json(
      { error: "이미 사진이 첨부되어 있습니다. 삭제 후 다시 첨부해주세요." },
      { status: 409 }
    );
  }

  const storagePath = buildPhotoStoragePath(logId, crypto.randomUUID(), file.type);

  const { error: uploadError } = await admin.storage
    .from(CARE_LOG_PHOTO_BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    // 원문 메시지에 경로가 섞일 수 있어 사용자에게 노출하지 않는다.
    console.error("간병일지 사진 업로드 실패");
    return NextResponse.json(
      { error: "사진 업로드에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 500 }
    );
  }

  // file_url 컬럼에는 공개 URL이 아니라 Storage 객체 경로를 넣는다. 버킷이
  // private이라 URL을 미리 만들어 둘 수 없고, 읽는 시점에 signed URL을
  // 발급해야 하기 때문이다(컬럼 이름은 과거 설계의 흔적이다).
  const { error: insertError } = await admin.from("care_log_photos").insert({
    log_id: logId,
    file_url: storagePath,
  });

  if (insertError) {
    // DB 기록에 실패하면 방금 올린 파일을 되돌려 고아 파일을 남기지 않는다.
    await admin.storage.from(CARE_LOG_PHOTO_BUCKET).remove([storagePath]);

    console.error("care_log_photos insert 실패:", insertError.message);
    return NextResponse.json(
      { error: "사진 정보를 저장하지 못했습니다." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; logId: string }> }
) {
  if (!isSameOriginRequest(request)) {
    return sameOriginErrorResponse();
  }

  const { id: caseId, logId } = await params;

  let auth;

  try {
    auth = await requireCurrentCaregiverSession(caseId);
  } catch (error) {
    if (error instanceof CaregiverAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }

  const guard = await loadEditableLog(caseId, logId, auth.caregiver.caregiver_id);

  if ("response" in guard) {
    return guard.response;
  }

  const admin = createSupabaseAdminClient();

  const { data: photos } = await admin
    .from("care_log_photos")
    .select("photo_id, file_url")
    .eq("log_id", logId);

  if (!photos || photos.length === 0) {
    return NextResponse.json({ error: "첨부된 사진이 없습니다." }, { status: 404 });
  }

  // Storage 파일을 먼저 지운다. DB 행만 지우면 파일이 버킷에 고아로 남고,
  // 반대로 파일만 지워지고 DB가 남으면 화면이 깨진 사진을 가리키게 된다.
  // 파일 삭제가 실패하면 DB 행을 남겨 두어 다시 시도할 수 있게 한다.
  const paths = photos.map((item) => item.file_url).filter(Boolean) as string[];

  if (paths.length > 0) {
    const { error: removeError } = await admin.storage
      .from(CARE_LOG_PHOTO_BUCKET)
      .remove(paths);

    if (removeError) {
      console.error("간병일지 사진 파일 삭제 실패");
      return NextResponse.json(
        { error: "사진을 삭제하지 못했습니다. 잠시 후 다시 시도해주세요." },
        { status: 500 }
      );
    }
  }

  const { error: deleteError } = await admin
    .from("care_log_photos")
    .delete()
    .eq("log_id", logId);

  if (deleteError) {
    console.error("care_log_photos 삭제 실패:", deleteError.message);
    return NextResponse.json(
      { error: "사진 정보를 삭제하지 못했습니다." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
