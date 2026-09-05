import { redirect } from "next/navigation";
import { CaregiverAuthError, requireActiveCaseMemberSession } from "@/lib/caregiver-auth";
import CareLogEditor from "@/app/cases/[id]/care-logs/CareLogEditor";
import CareLogClient from "./CareLogClient";
import {
  CARE_LOG_EDIT_WINDOW_MS,
  CARE_LOG_PHOTO_BUCKET,
  isWithinCareLogEditWindow,
} from "@/lib/care-log-photo";
import { getCareLogToday } from "@/lib/care-log-date";
import { formatKstDateTime } from "@/lib/kst";
import { readQrPass } from "@/lib/qr-pass-cookie";
import { checkQrPassAgainstCase, QR_PASS_REQUIRED_MESSAGE } from "@/lib/qr-pass";

export default async function CaseCareLogPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 간병일지 "작성" 화면. 이 사례에 활성 상태로 연결된 간병인이면 누구나
  // 작성할 수 있다 — 현재 간병인 여부는 보지 않는다(가족들이 번갈아
  // 돌보는 것이 실제 운영 형태다). 사례가 종료됐거나 연결이 없으면
  // 서버에서 차단하고, 작성자는 항상 세션 쿠키의 caregiver로 기록된다.
  let auth;

  try {
    auth = await requireActiveCaseMemberSession(id);
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

  // 이 화면은 환자명 표시에만 사례 데이터를 쓴다. 작성자 정보는 세션에서
  // 오므로 case_caregivers를 중첩 조회할 이유가 없다.
  // hospital_id는 아래 QR 증표 대조에만 쓴다.
  const { data: caseData, error } = await supabase
    .from("cases")
    .select("case_id, patient_name, hospital_id")
    .eq("case_id", id)
    .maybeSingle();

  if (error) {
    return <main className="p-8">사례 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.</main>;
  }

  if (!caseData) {
    return <main className="p-8">사례 정보를 찾을 수 없습니다.</main>;
  }

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
              로그인: {caregiver.caregiver_name ?? "-"} (
              {caseCaregiver.relationship ?? "-"})
            </p>

            <div className="mt-4 bg-blue-50 text-blue-800 p-3 rounded text-sm">
              오늘({todayLog.care_date}) 간병일지는 이미 작성되었습니다.
            </div>
          </div>

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

  // 여기부터는 "오늘 일지가 없어 새로 작성하는" 경우다. 새 작성은 병원 QR을
  // 스캔한 뒤에만 가능하다(운영 정책, 2026-09-05 확정) — 작성 API가 같은
  // 조건으로 거부하므로, 폼을 띄웠다가 저장에서 막히지 않게 여기서 먼저
  // 안내한다. 위의 "오늘 일지 있음" 분기(조회·정정)는 이 검사를 거치지
  // 않는다.
  const qrPassCheck = checkQrPassAgainstCase(await readQrPass(), caseData.hospital_id);

  if (!qrPassCheck.allowed) {
    return (
      <main className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-md mx-auto space-y-4">
          <div className="bg-white rounded-lg shadow p-5">
            <h1 className="text-2xl font-bold">간병일지 작성</h1>

            <p className="text-gray-600 mt-2">환자명: {caseData.patient_name}</p>

            <div className="mt-4 bg-[#FFF2F5] border border-[#FFE1E8] text-[#D94C72] p-3 rounded text-sm font-bold">
              {QR_PASS_REQUIRED_MESSAGE}
            </div>

            <p className="text-sm text-gray-700 mt-3 leading-snug">
              간병일지는 병원에 비치된 QR을 스캔한 뒤 작성할 수 있습니다. QR을
              스캔하면 나오는 화면에서 <b>간병일지 작성</b>을 눌러 주세요.
            </p>
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

  // 위에서 requireActiveCaseMemberSession()을 통과했으므로 로그인 상태와
  // "이 사례의 활성 구성원" 여부는 이미 서버에서 확정된 사실이다.
  const caregiverStatus = {
    loggedIn: true,
    isActiveMember: true,
    caregiverName: caregiver.caregiver_name as string | null,
  };

  return (
    <CareLogClient
      caseId={id}
      patientName={caseData.patient_name}
      writerName={caregiver.caregiver_name ?? null}
      writerRelationship={caseCaregiver.relationship ?? null}
      caregiverStatus={caregiverStatus}
      /*
       * 위치정보 동의는 (case_id, caregiver_id) 단위다 — 지금 로그인한
       * 간병인의 case_caregivers 행 값을 그대로 넘긴다. null이면 이 사례에서
       * 아직 한 번도 답하지 않은 것이므로 화면이 최초 질문을 띄운다.
       * 다른 간병인의 선택은 다른 행이라 여기 섞이지 않는다.
       */
      locationConsent={caseCaregiver.location_consent ?? null}
    />
  );
}
