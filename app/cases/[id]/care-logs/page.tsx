import { redirect } from "next/navigation";
import { CaregiverAuthError, requireCaseMemberSession } from "@/lib/caregiver-auth";
import type { CareLog, Hospital } from "@/types/domain";
import {
  CARE_LOG_EDIT_WINDOW_MS,
  CARE_LOG_PHOTO_BUCKET,
  isWithinCareLogEditWindow,
} from "@/lib/care-log-photo";
import { getAdminViewerSession } from "@/lib/admin-auth";
import { formatKstDateTime } from "@/lib/kst";
import CareLogEditor from "./CareLogEditor";

function getLocationFailureLabel(reason?: string | null) {
  if (reason === "permission_denied") return "사용자가 위치 권한을 거부함";
  if (reason === "position_unavailable") return "기기에서 위치정보를 확인할 수 없음";
  if (reason === "timeout") return "위치 확인 시간이 초과됨";
  if (reason === "geolocation_not_supported") return "기기 또는 브라우저가 위치 확인을 지원하지 않음";
  if (reason === "unknown_error") return "알 수 없는 위치 확인 오류";
  return "미기록 사유를 확인할 수 없음";
}

export default async function CaseCareLogsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 통합 간병일지 조회 화면도 caseId URL만 안다고 아무나 볼 수 없어야
  // 한다. "로그인 + 이 사례에 활성 상태로 연결된 caregiver인지"만 확인하고
  // (현재 간병인 여부는 요구하지 않음 — 조회 전용 화면), 간병종료된 사례도
  // 기존 기록은 계속 조회 가능하도록 case 상태는 확인하지 않는다.
  let auth = null;
  let adminSupabase = null;

  try {
    auth = await requireCaseMemberSession(id);
  } catch (authError) {
    if (!(authError instanceof CaregiverAuthError)) {
      throw authError;
    }

    // 관리자는 사례에 간병인으로 연결되어 있지 않아 위 검증을 통과할 수
    // 없다. 관리자 화면에서 넘어온 경우까지 간병인 휴대폰 인증을 요구하면
    // 볼 수 있는 일지가 하나도 없게 되므로, 관리자 세션이면 조회를
    // 허용한다. 이 화면은 조회 전용이라 노출 범위가 늘어나지 않는다.
    const adminViewer = await getAdminViewerSession();

    if (!adminViewer) {
      if (authError.status === 401) {
        redirect(`/caregiver-login?next=${encodeURIComponent(`/cases/${id}/care-logs`)}`);
      }

      // 403(권한 없음)과 404(사례 없음)를 각각 다른 안내로 보여주되, 어느
      // 경우에도 환자 정보는 노출하지 않는다.
      return <main className="p-8">{authError.message}</main>;
    }

    adminSupabase = adminViewer.supabase;
  }

  const supabase = auth?.supabase ?? adminSupabase!;

  const { data: caseData, error: caseError } = await supabase
    .from("cases")
    .select(`
      case_id,
      case_no,
      patient_name,
      room_no,
      hospitals (
        hospital_name
      )
    `)
    .eq("case_id", id)
    .maybeSingle();

  if (caseError) {
    return (
      <main className="p-8">
        사례 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.
      </main>
    );
  }

  if (!caseData) {
    return (
      <main className="p-8">
        사례 정보를 찾을 수 없습니다.
      </main>
    );
  }

  // care_logs.caregiver_id는 DB에 caregivers를 향한 FK가 없어 PostgREST가
  // 관계를 추론하지 못한다(PGRST200). caregivers를 중첩 select하지 않는다 —
  // 작성자 이름은 작성 시점에 이미 이 행 자체의 writer_name/signature_name에
  // 저장되어 있으므로 별도 조회도 필요 없다. 관리자가 삭제한 간병일지는 이
  // 조회 화면에 노출하지 않는다.
  const { data: logs, error } = await supabase
    .from("care_logs")
    .select("*")
    .eq("case_id", id)
    .is("deleted_at", null)
    .order("care_date", { ascending: false })
    .order("created_at", { ascending: false });

  // 첨부 사진. 버킷이 private이라 공개 URL이 없고, 화면을 그릴 때마다 짧은
  // 유효기간의 signed URL을 발급한다. care_log_photos.file_url에는 URL이
  // 아니라 Storage 객체 경로가 들어 있다(lib/care-log-photo.ts 참고).
  const photoUrlByLogId = new Map<string, string>();
  const logIds = (logs || []).map((log: CareLog) => log.log_id);

  if (logIds.length > 0) {
    const { data: photos } = await supabase
      .from("care_log_photos")
      .select("log_id, file_url")
      .in("log_id", logIds);

    for (const photo of photos || []) {
      if (!photo.file_url) continue;

      const { data: signed } = await supabase.storage
        .from(CARE_LOG_PHOTO_BUCKET)
        .createSignedUrl(photo.file_url, 60 * 30);

      if (signed?.signedUrl) {
        photoUrlByLogId.set(photo.log_id, signed.signedUrl);
      }
    }
  }

  // 작성 후 짧은 창 안에서는 자기가 쓴 일지를 정정할 수 있다. 여기서
  // 정하는 것은 "수정 UI를 보여줄지"뿐이고, 실제 허용 여부는 서버 라우트가
  // 다시 판정한다(app/api/cases/[id]/care-logs/[logId]/route.ts). 관리자
  // 조회(auth === null)에는 수정 UI를 보여주지 않는다 — 이 화면은 관리자에게
  // 조회 전용이다.
  const memberCaseStatus = Array.isArray(auth?.caseCaregiver.cases)
    ? auth?.caseCaregiver.cases[0]?.status
    : auth?.caseCaregiver.cases?.status;

  // 작성 권한과 같은 기준이다: 이 사례의 활성 구성원(auth가 있으면 이미
  // 확인된 사실)이고 사례가 진행 중이면 자기 일지를 정정할 수 있다.
  // 현재 간병인 여부는 보지 않는다 — 본인 확인은 아래 caregiver_id 대조와
  // 서버 라우트가 한다.
  const canEditOwnLogs = Boolean(auth) && memberCaseStatus === "입원중";

  const viewerCaregiverId = auth?.caregiver.caregiver_id ?? null;

  if (error) {
    console.error(
      "간병일지 조회 실패:",
      error.message,
      "code:",
      error.code,
      "details:",
      error.details,
      "hint:",
      error.hint
    );

    return (
      <main className="p-8">
        간병일지 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto space-y-4">
        <div className="bg-white rounded-lg shadow p-5">
          <h1 className="text-2xl font-bold">
            통합 간병일지
          </h1>

          <div className="mt-3 space-y-1 text-sm text-gray-600">
            <p>환자명: {caseData.patient_name || "-"}</p>
            <p>사례번호: {caseData.case_no || "-"}</p>
            <p>병원: {(caseData.hospitals as unknown as Pick<Hospital, "hospital_name"> | null)?.hospital_name || "-"}</p>
            <p>입원호실: {caseData.room_no || "-"}</p>
          </div>
        </div>

        {logs && logs.length > 0 ? (
          logs.map((log: CareLog) => {
            const locationChecked =
              log.location_status === "checked";

            return (
              <div
                key={log.log_id}
                className="bg-white border rounded-lg p-5 shadow-sm"
              >
                <div className="mb-4">
                  <p className="font-bold text-lg">
                    {log.care_date}
                  </p>

                  <p className="text-sm text-gray-700">
                    작성시간:{" "}
                    {formatKstDateTime(log.created_at)}
                  </p>
                </div>

                <div className="mb-4 rounded border bg-gray-50 p-3 text-sm">
                  <p>
                    작성자:{" "}
                    {log.writer_name || log.signature_name || "-"}
                  </p>

                  <p>
                    환자와의 관계: {log.relationship || "-"}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm mb-4">
                  <p>
                    식사보조: {log.meal_assist ? "O" : "X"}
                  </p>

                  <p>
                    이동보조: {log.move_assist ? "O" : "X"}
                  </p>

                  <p>
                    배설보조: {log.toilet_assist ? "O" : "X"}
                  </p>

                  <p>
                    위생관리: {log.hygiene_assist ? "O" : "X"}
                  </p>

                  <p>
                    체위변경: {log.position_change ? "O" : "X"}
                  </p>
                </div>

                <div
                  className={`rounded border p-3 text-sm ${
                    locationChecked
                      ? "bg-green-50 border-green-200"
                      : "bg-red-50 border-red-200"
                  }`}
                >
                  <p className="font-bold">
                    위치 확인:{" "}
                    {locationChecked ? "확인 완료" : "미기록"}
                  </p>

                  {locationChecked ? (
                    <>
                      <p className="mt-1 text-gray-700">
                        확인시간:{" "}
                        {formatKstDateTime(log.location_checked_at)}
                      </p>

                      <p className="mt-1 text-xs text-gray-700">
                        위도: {log.latitude ?? "-"}
                      </p>

                      <p className="text-xs text-gray-700">
                        경도: {log.longitude ?? "-"}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-red-700">
                      미기록 사유:{" "}
                      {getLocationFailureLabel(
                        log.location_failure_reason
                      )}
                    </p>
                  )}
                </div>

                <div className="border-t mt-4 pt-3 text-sm">
                  <p>
                    특이사항: {log.memo || "-"}
                  </p>

                  <p className="mt-1">
                    전자서명:{" "}
                    {log.signature_name ||
                      log.writer_name ||
                      "-"}
                  </p>
                </div>

                {photoUrlByLogId.has(log.log_id) && (
                  <div className="border-t mt-4 pt-3">
                    <p className="text-sm mb-2">첨부 사진</p>

                    {/* Supabase signed URL이라 next/image 최적화 대상이 아니다. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photoUrlByLogId.get(log.log_id)}
                      alt="간병일지 첨부 사진"
                      className="w-full max-h-72 object-contain rounded border"
                    />
                  </div>
                )}

                {canEditOwnLogs &&
                  log.caregiver_id === viewerCaregiverId &&
                  isWithinCareLogEditWindow(log.created_at) && (
                    <CareLogEditor
                      caseId={id}
                      logId={log.log_id}
                      hasPhoto={photoUrlByLogId.has(log.log_id)}
                      editableUntil={new Date(
                        new Date(log.created_at as string).getTime() +
                          CARE_LOG_EDIT_WINDOW_MS
                      ).toISOString()}
                      initialValues={{
                        meal_assist: Boolean(log.meal_assist),
                        move_assist: Boolean(log.move_assist),
                        toilet_assist: Boolean(log.toilet_assist),
                        hygiene_assist: Boolean(log.hygiene_assist),
                        position_change: Boolean(log.position_change),
                        memo: log.memo || "",
                      }}
                    />
                  )}
              </div>
            );
          })
        ) : (
          <div className="bg-white border rounded-lg p-5 text-gray-700">
            아직 작성된 간병일지가 없습니다.
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 pb-8">
          <a
            href={`/case-care-log/${caseData.case_id}`}
            className="text-center bg-blue-600 text-white px-4 py-3 rounded"
          >
            오늘 간병일지 작성
          </a>

          <a
            href={`/cases/${caseData.case_id}`}
            className="text-center bg-gray-700 text-white px-4 py-3 rounded"
          >
            사례 상세로 돌아가기
          </a>
        </div>
      </div>
    </main>
  );
}