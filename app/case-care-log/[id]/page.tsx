import { redirect } from "next/navigation";
import { CaregiverAuthError, requireCurrentCaregiverSession } from "@/lib/caregiver-auth";
import {
  canShowCurrentCaregiverChange,
  getCurrentCaregiverChangeCandidates,
} from "@/lib/case-caregivers";
import ChangeCurrentCaregiver from "@/app/cases/[id]/ChangeCurrentCaregiver";
import CareLogEditor from "@/app/cases/[id]/care-logs/CareLogEditor";
import CareLogClient from "./CareLogClient";
import {
  CARE_LOG_EDIT_WINDOW_MS,
  CARE_LOG_PHOTO_BUCKET,
  isWithinCareLogEditWindow,
} from "@/lib/care-log-photo";
import { getCareLogToday } from "@/lib/care-log-date";
import { formatKstDateTime } from "@/lib/kst";
import type { CaseCaregiver } from "@/types/domain";

export default async function CaseCareLogPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 간병일지 "작성" 화면이므로, 사례 데이터를 조회하기 전에 먼저
  // "이 caseId의 현재 간병인으로 로그인한 세션인지"를 서버에서 확인한다
  // (caseId URL만 안다고 다른 환자 사례를 볼 수 없어야 함). 클라이언트가
  // 보낸 caregiver_id는 사용하지 않고, 항상 세션 쿠키로 식별한다.
  let auth;

  try {
    auth = await requireCurrentCaregiverSession(id);
  } catch (authError) {
    if (!(authError instanceof CaregiverAuthError)) {
      throw authError;
    }

    if (authError.status === 401) {
      redirect(`/caregiver-login?next=${encodeURIComponent(`/case-care-log/${id}`)}`);
    }

    // 403(권한 없음)과 404(사례 없음), 400(간병종료)을 각각 다른 안내로
    // 보여주되, 어느 경우에도 환자 정보는 노출하지 않는다.
    return <main className="p-8">{authError.message}</main>;
  }

  const { supabase, caregiver, caseCaregiver } = auth;

  // caregivers(*)로 전체 컬럼을 가져오지 않는다 — 이 화면은
  // currentCaregiver.caregivers.caregiver_name만 쓴다. 주민등록번호
  // 원문/마스킹/암호화 컬럼을 매 요청마다 불필요하게 가져올 이유가 없다.
  const { data: caseData, error } = await supabase
    .from("cases")
    .select(
      `
      *,
      hospitals (*),
      case_caregivers (
        *,
        caregivers (caregiver_id, caregiver_name)
      )
    `
    )
    .eq("case_id", id)
    .maybeSingle();

  if (error) {
    return <main className="p-8">사례 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.</main>;
  }

  if (!caseData) {
    return <main className="p-8">사례 정보를 찾을 수 없습니다.</main>;
  }

  const currentCaregiver = caseData.case_caregivers?.find(
    (item: CaseCaregiver) => item.is_current_caregiver
  );

  if (!currentCaregiver) {
    return <main className="p-8">현재 간병인이 지정되어 있지 않습니다.</main>;
  }

  // 현재 간병인 변경 노출 조건은 사례 상세(app/cases/[id]/page.tsx)와
  // 같은 lib/case-caregivers.ts 규칙으로 판단한다 — 두 화면이 서로 다른
  // 기준을 갖지 않게 하기 위해서다. 컴포넌트도 사례 상세의 것을 그대로
  // 재사용한다(같은 기능을 복제하지 않는다).
  //
  // canManage에 true를 넘기는 근거: 위 requireCurrentCaregiverSession(id)를
  // 통과했다는 것은 (1) 로그인 상태이고 (2) 이 사례의 현재 간병인 본인이며
  // (3) 사례가 아직 진행 중(간병종료면 400으로 막힌다)이라는 뜻이다 —
  // 사례 상세가 canManage로 확인하는 조건과 같은 내용을 이 화면은 이미
  // 진입 시점에 강제하고 있다.
  const showCurrentCaregiverChange = canShowCurrentCaregiverChange(
    caseData.case_caregivers,
    true
  );

  const currentCaregiverChange = showCurrentCaregiverChange ? (
    <ChangeCurrentCaregiver
      caseId={id}
      caregivers={getCurrentCaregiverChangeCandidates(caseData.case_caregivers)}
    />
  ) : null;

  // 오늘 일지가 이미 있으면 작성 폼을 띄우지 않는다. 띄워 봤자 저장 시점에
  // 409로 거부되어(작성 API의 중복 검사) 입력한 내용만 잃게 된다. 대신 그
  // 일지를 보여주고, 아직 정정 창 안이며 본인이 쓴 것이면 이 자리에서 바로
  // 고칠 수 있게 한다. 날짜 기준은 작성 API와 반드시 같아야 하므로
  // lib/care-log-date.ts의 같은 함수를 쓴다.
  const today = getCareLogToday();

  const { data: todayLog } = await supabase
    .from("care_logs")
    .select(
      "log_id, caregiver_id, care_date, created_at, meal_assist, move_assist, toilet_assist, hygiene_assist, position_change, memo, location_status"
    )
    .eq("case_id", id)
    .eq("care_date", today)
    .is("deleted_at", null)
    .maybeSingle();

  if (todayLog) {
    // 첨부 사진. 버킷이 private이라 화면을 그릴 때마다 짧은 유효기간의
    // signed URL을 발급한다(다른 조회 화면과 같은 방식).
    let photoUrl: string | null = null;

    const { data: photos } = await supabase
      .from("care_log_photos")
      .select("file_url")
      .eq("log_id", todayLog.log_id);

    const photoPath = photos?.[0]?.file_url;

    if (photoPath) {
      const { data: signed } = await supabase.storage
        .from(CARE_LOG_PHOTO_BUCKET)
        .createSignedUrl(photoPath, 60 * 30);

      photoUrl = signed?.signedUrl ?? null;
    }

    // 오늘 일지는 사례 단위로 하루 1건이라, 그 사이 현재 간병인이 바뀌었다면
    // 지금 로그인한 사람이 작성자가 아닐 수 있다. 그 경우에는 정정할 수 없다.
    const isAuthor = todayLog.caregiver_id === caregiver.caregiver_id;
    const editable = isAuthor && isWithinCareLogEditWindow(todayLog.created_at);

    const activities: [string, boolean][] = [
      ["식사보조", Boolean(todayLog.meal_assist)],
      ["이동보조", Boolean(todayLog.move_assist)],
      ["배설보조", Boolean(todayLog.toilet_assist)],
      ["위생관리", Boolean(todayLog.hygiene_assist)],
      ["체위변경", Boolean(todayLog.position_change)],
    ];

    return (
      <main className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-md mx-auto space-y-4">
          <div className="bg-white rounded-lg shadow p-5">
            <h1 className="text-2xl font-bold">간병일지 작성</h1>

            <p className="text-gray-600 mt-2">환자명: {caseData.patient_name}</p>

            <p className="text-gray-600">
              현재 간병인: {currentCaregiver.caregivers?.caregiver_name ?? "-"} (
              {currentCaregiver.relationship ?? "-"})
            </p>

            <div className="mt-4 bg-blue-50 text-blue-800 p-3 rounded text-sm">
              오늘({todayLog.care_date}) 간병일지는 이미 작성되었습니다.
            </div>
          </div>

          {currentCaregiverChange}

          <div className="bg-white rounded-lg shadow p-5">
            <h2 className="font-bold mb-1">오늘 작성된 간병일지</h2>

            <p className="text-sm text-gray-600">
              작성시간:{" "}
              {formatKstDateTime(todayLog.created_at)}
            </p>

            <div className="grid grid-cols-2 gap-2 text-sm mt-4">
              {activities.map(([label, done]) => (
                <p key={label}>
                  {label}: {done ? "O" : "X"}
                </p>
              ))}
            </div>

            <div className="border-t mt-4 pt-3 text-sm">
              <p>특이사항: {todayLog.memo || "-"}</p>

              <p className="mt-1">
                위치 확인:{" "}
                {todayLog.location_status === "checked" ? "확인 완료" : "미기록"}
              </p>
            </div>

            {photoUrl && (
              <div className="border-t mt-4 pt-3">
                <p className="text-sm mb-2">첨부 사진</p>

                {/* Supabase signed URL이라 next/image 최적화 대상이 아니다. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoUrl}
                  alt="간병일지 첨부 사진"
                  className="w-full max-h-72 object-contain rounded border"
                />
              </div>
            )}

            {editable ? (
              <CareLogEditor
                caseId={id}
                logId={todayLog.log_id}
                hasPhoto={Boolean(photoUrl)}
                editableUntil={new Date(
                  new Date(todayLog.created_at as string).getTime() +
                    CARE_LOG_EDIT_WINDOW_MS
                ).toISOString()}
                initialValues={{
                  meal_assist: Boolean(todayLog.meal_assist),
                  move_assist: Boolean(todayLog.move_assist),
                  toilet_assist: Boolean(todayLog.toilet_assist),
                  hygiene_assist: Boolean(todayLog.hygiene_assist),
                  position_change: Boolean(todayLog.position_change),
                  memo: todayLog.memo || "",
                }}
              />
            ) : (
              <p className="border-t mt-4 pt-3 text-xs text-gray-600">
                {isAuthor
                  ? "수정할 수 있는 시간(작성 후 1시간)이 지났습니다."
                  : "다른 간병인이 작성한 일지라 수정할 수 없습니다."}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2 pb-8">
            <a
              href={`/cases/${id}/care-logs`}
              className="text-center bg-blue-600 text-white px-4 py-3 rounded"
            >
              작성기록 보기
            </a>

            <a
              href={`/cases/${id}`}
              className="text-center bg-gray-700 text-white px-4 py-3 rounded"
            >
              사례 상세로 돌아가기
            </a>
          </div>
        </div>
      </main>
    );
  }

  // 위에서 requireCurrentCaregiverSession()을 통과했으므로 로그인 상태와
  // 현재 간병인 여부는 이미 서버에서 확정된 사실이다.
  const caregiverStatus = {
    loggedIn: true,
    isCurrent: true,
    caregiverName: caregiver.caregiver_name as string | null,
  };

  return (
    <CareLogClient
      caseId={id}
      patientName={caseData.patient_name}
      currentCaregiverName={currentCaregiver.caregivers?.caregiver_name ?? null}
      currentCaregiverRelationship={currentCaregiver.relationship ?? null}
      caregiverStatus={caregiverStatus}
      /*
       * 위치정보 동의는 (case_id, caregiver_id) 단위다 — 지금 로그인한
       * 간병인의 case_caregivers 행 값을 그대로 넘긴다. null이면 이 사례에서
       * 아직 한 번도 답하지 않은 것이므로 화면이 최초 질문을 띄운다.
       * 다른 간병인의 선택은 다른 행이라 여기 섞이지 않는다.
       */
      locationConsent={caseCaregiver.location_consent ?? null}
      currentCaregiverChange={currentCaregiverChange}
    />
  );
}
