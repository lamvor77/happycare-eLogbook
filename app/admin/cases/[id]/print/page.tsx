import { requireAdmin } from "@/lib/admin-auth";
import PrintButton from "./PrintButton";
import { CARE_LOG_PHOTO_BUCKET } from "@/lib/care-log-photo";
import type { CareLog } from "@/types/domain";
import { formatKstDateTime, getKstToday } from "@/lib/kst";

function getLocationFailureLabel(reason?: string | null) {
  if (reason === "permission_denied") {
    return "사용자가 위치 권한을 거부함";
  }

  if (reason === "position_unavailable") {
    return "기기에서 위치정보를 확인할 수 없음";
  }

  if (reason === "timeout") {
    return "위치 확인 시간이 초과됨";
  }

  if (reason === "geolocation_not_supported") {
    return "기기 또는 브라우저가 위치 확인을 지원하지 않음";
  }

  if (reason === "unknown_error") {
    return "알 수 없는 위치 확인 오류";
  }

  return "미기록 사유를 확인할 수 없음";
}

export default async function AdminCasePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { supabase } = await requireAdmin();

  const { id } = await params;

  const { data: caseData, error: caseError } = await supabase
    .from("cases")
    .select(`
      *,
      hospitals (
        hospital_name,
        hospital_address,
        hospital_phone
      )
    `)
    .eq("case_id", id)
    .single();

  if (caseError || !caseData) {
    return (
      <main className="p-8">
        사례 정보를 찾을 수 없습니다.
      </main>
    );
  }

  // care_logs.caregiver_id는 DB에 caregivers를 향한 FK가 없어 PostgREST가
  // 관계를 추론하지 못한다(PGRST200). caregivers를 중첩 select하지 않는다 —
  // 작성자 이름은 작성 시점에 이미 이 행 자체의 writer_name/signature_name에
  // 저장되어 있으므로 별도 조회도 필요 없다(이 문서에는 전화번호를 표시하는
  // 칸도 없다). 공식 문서이므로 관리자가 삭제한 간병일지는 기본적으로
  // 출력하지 않는다.
  const { data: logs, error: logsError } = await supabase
    .from("care_logs")
    .select("*")
    .eq("case_id", id)
    .is("deleted_at", null)
    .order("care_date", { ascending: true })
    .order("created_at", { ascending: true });

  // 첨부 사진. 버킷이 private이라 공개 URL이 없고, 출력 시점에 짧은 유효기간의
  // signed URL을 발급해 <img>로 그린다. care_log_photos.file_url에는 URL이
  // 아니라 Storage 객체 경로가 들어 있다(lib/care-log-photo.ts 참고).
  const logIds = (logs || []).map((log: { log_id: string }) => log.log_id);

  const photoUrlByLogId = new Map<string, string>();

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

  if (logsError) {
    console.error(
      "간병일지 조회 실패:",
      logsError.message,
      "code:",
      logsError.code,
      "details:",
      logsError.details,
      "hint:",
      logsError.hint
    );

    return (
      <main className="p-8">
        간병일지 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.
      </main>
    );
  }

  // 관리자 화면 전용 상태 표시(건수/존재 여부만, 개인정보 원문 없음) —
  // 인쇄되는 문서 내용에는 포함되지 않는다(아래 렌더링에서 print:hidden).
  const { count: activeCaregiverCount } = await supabase
    .from("case_caregivers")
    .select("*", { count: "exact", head: true })
    .eq("case_id", id)
    .eq("status", "활성");

  const { count: consentCount } = await supabase
    .from("case_consents")
    .select("*", { count: "exact", head: true })
    .eq("case_id", id);

  const needsCaregiverLink =
    caseData.source_type === "google_form" && (activeCaregiverCount || 0) === 0;

  const today = getKstToday();

  const documentNo = `HG-${
    caseData.case_no || caseData.case_id.slice(0, 8)
  }-${today.replaceAll("-", "")}`;

  return (
    <main className="p-6 md:p-8 print:p-0 max-w-6xl mx-auto bg-white">
      {/* 관리자 화면 전용 상태 표시 — 인쇄 시 숨김(print:hidden), 문서
          내용에는 포함되지 않는다. */}
      <div className="print:hidden mb-4 rounded border p-3 text-sm text-gray-800 bg-gray-50">
        <p>
          유입경로: {caseData.source_type === "google_form" ? "구글폼" : "병원QR"}
          {" · "}
          간병인 연결: {activeCaregiverCount || 0}명
          {" · "}
          등록 동의 기록: {(consentCount || 0) > 0 ? "있음" : "없음"}
        </p>

        {needsCaregiverLink && (
          <p className="mt-2 font-bold text-orange-800">
            간병인 연결 필요 — 구글폼으로 등록된 사례이며 아직 어떤
            간병인과도 연결되어 있지 않습니다. 가족코드(
            {caseData.family_code || "-"})로 /case-join 참여를 안내하거나
            관리자가 대신 연결해야 합니다.
          </p>
        )}
      </div>

      <header className="mb-6 text-center">
        <h1 className="text-3xl font-bold">
          가족간병 통합 간병일지
        </h1>

        <p className="mt-2 text-sm text-gray-700">
          문서번호: {documentNo}
        </p>
      </header>

      <section className="mb-6 border rounded p-4">
        <h2 className="font-bold mb-3">병원 및 환자 정보</h2>

        {/* 인쇄에서도 2열을 유지한다. md: 는 뷰포트 768px 이상에서만 적용되는데
            인쇄 기준 폭은 A4에서 여백을 뺀 약 700px이라 조건에 걸리지 않아
            화면(2열)과 인쇄물(1열)이 달라 보였다. */}
        <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-2 text-sm">
          <p>
            병원명: {caseData.hospitals?.hospital_name || "-"}
          </p>

          <p>
            병원주소: {caseData.hospitals?.hospital_address || "-"}
          </p>

          <p>
            병원 연락처: {caseData.hospitals?.hospital_phone || "-"}
          </p>

          <p>
            사례번호: {caseData.case_no || "-"}
          </p>

          <p>
            등록번호: {caseData.registration_no || "-"}
          </p>

          <p>
            환자명: {caseData.patient_name || "-"}
          </p>

          <p>
            생년월일: {caseData.patient_birth_date || "-"}
          </p>

          <p>
            성별: {caseData.patient_gender || "-"}
          </p>

          <p>
            입원호실: {caseData.room_no || "-"}
          </p>

          <p>
            진단명: {caseData.diagnosis_name || "-"}
          </p>

          <p>
            보험사: {caseData.insurance_company || "-"}
          </p>

          <p>
            사고유형: {caseData.accident_type || "-"}
          </p>

          <p>
            간병기간: {caseData.care_start_date || "-"} ~{" "}
            {caseData.care_end_date || "-"}
          </p>

          <p>
            상태: {caseData.status || "-"}
          </p>
        </div>
      </section>

      <section>
        <h2 className="font-bold mb-3">통합 간병일지</h2>

        {/* 표는 컬럼이 14개라 화면에서는 1200px를 확보하고 가로 스크롤로
            본다. 그런데 인쇄에는 스크롤이 없어 A4 세로 폭(약 650~720px)을
            넘는 부분이 그대로 잘려 나갔다 — 뒤쪽의 미기록 사유/전자서명/
            특이사항이 인쇄물에서 사라졌다. 증빙 문서에서 서명과 특이사항이
            빠지면 안 되므로, 인쇄할 때만 최소 폭을 풀고(print:min-w-0)
            글자·여백을 줄여 14개 컬럼을 페이지 안에 담는다. 화면 레이아웃은
            그대로다.

            글자 크기는 팩스 전송을 염두에 두고 정한다 — 팩스는 해상도가
            낮아 너무 작은 글자가 뭉개진다. 대신 좌우 여백을 줄여 폭 예산을
            맞춘다. 세로 여백은 줄이지 않는다(행 구분이 흐려진다). */}
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full min-w-[1200px] print:min-w-0 border-collapse border text-xs print:text-[10px]">
            <thead>
              <tr>
                <th className="border p-2 print:px-0.5 print:py-1">간병일자</th>
                <th className="border p-2 print:px-0.5 print:py-1">작성일시</th>
                <th className="border p-2 print:px-0.5 print:py-1">작성자</th>
                <th className="border p-2 print:px-0.5 print:py-1">관계</th>
                <th className="border p-2 print:px-0.5 print:py-1">식사</th>
                <th className="border p-2 print:px-0.5 print:py-1">이동</th>
                <th className="border p-2 print:px-0.5 print:py-1">배설</th>
                <th className="border p-2 print:px-0.5 print:py-1">위생</th>
                <th className="border p-2 print:px-0.5 print:py-1">체위</th>
                <th className="border p-2 print:px-0.5 print:py-1">위치 확인</th>
                <th className="border p-2 print:px-0.5 print:py-1">위치 확인 시간</th>
                <th className="border p-2 print:px-0.5 print:py-1">미기록 사유</th>
                <th className="border p-2 print:px-0.5 print:py-1">전자서명</th>
                <th className="border p-2 print:px-0.5 print:py-1">특이사항</th>
              </tr>
            </thead>

            <tbody>
              {logs && logs.length > 0 ? (
                logs.map((log: CareLog) => {
                  const locationChecked =
                    log.location_status === "checked";

                  return (
                    <tr key={log.log_id}>
                      <td className="border p-2 print:px-0.5 print:py-1 text-center">
                        {log.care_date || "-"}
                      </td>

                      <td className="border p-2 print:px-0.5 print:py-1">
                        {formatKstDateTime(log.created_at)}
                      </td>

                      <td className="border p-2 print:px-0.5 print:py-1">
                        {log.writer_name || log.signature_name || "-"}
                      </td>

                      <td className="border p-2 print:px-0.5 print:py-1">
                        {log.relationship || "-"}
                      </td>

                      <td className="border p-2 print:px-0.5 print:py-1 text-center">
                        {log.meal_assist ? "O" : "X"}
                      </td>

                      <td className="border p-2 print:px-0.5 print:py-1 text-center">
                        {log.move_assist ? "O" : "X"}
                      </td>

                      <td className="border p-2 print:px-0.5 print:py-1 text-center">
                        {log.toilet_assist ? "O" : "X"}
                      </td>

                      <td className="border p-2 print:px-0.5 print:py-1 text-center">
                        {log.hygiene_assist ? "O" : "X"}
                      </td>

                      <td className="border p-2 print:px-0.5 print:py-1 text-center">
                        {log.position_change ? "O" : "X"}
                      </td>

                      {/* 위치는 이 문서의 핵심 증빙이라 "확인 완료"만으로는
                          부족하다 — 실제 측정 좌표를 함께 싣는다. 컬럼을
                          늘리지 않고 같은 칸에 쌓아 표 폭에 영향을 주지
                          않는다. 주소로 바꾸려면 외부 지오코딩이 필요하다. */}
                      <td className="border p-2 print:px-0.5 print:py-1 text-center break-words">
                        {locationChecked ? (
                          <>
                            확인 완료
                            {log.latitude != null && log.longitude != null && (
                              <span className="block">
                                {log.latitude}, {log.longitude}
                              </span>
                            )}
                          </>
                        ) : (
                          "미기록"
                        )}
                      </td>

                      <td className="border p-2 print:px-0.5 print:py-1">
                        {formatKstDateTime(log.location_checked_at)}
                      </td>

                      <td className="border p-2 print:px-0.5 print:py-1 break-words">
                        {locationChecked
                          ? "-"
                          : getLocationFailureLabel(
                              log.location_failure_reason
                            )}
                      </td>

                      <td className="border p-2 print:px-0.5 print:py-1">
                        {log.signature_name ||
                          log.writer_name ||
                          "-"}
                      </td>

                      <td className="border p-2 print:px-0.5 print:py-1 break-words">
                        {log.memo || "-"}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan={14}
                    className="border p-6 print:p-2 text-center text-gray-700"
                  >
                    작성된 간병일지가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8 border-t pt-4 text-sm">
        <p>
          본 문서는 해피간병 시스템에 기록된 가족간병 활동을
          사례번호 기준으로 통합하여 생성한 문서입니다.
        </p>

        <p className="mt-1">
          위치 확인이 불가능한 기록은 해당 미기록 사유가 함께
          표시됩니다.
        </p>

        <p className="mt-1">
          문서번호: {documentNo}
        </p>
      </section>

      {/* 첨부 사진 부록 — 사진이 하나도 없으면 이 영역 자체를 만들지 않아
          빈 페이지가 생기지 않는다. 본문 표는 그대로 두고 문서 말미에만
          덧붙이므로 기존 출력 레이아웃이 바뀌지 않는다. */}
      {photoUrlByLogId.size > 0 && (
        <section className="mt-8 break-before-page">
          <h2 className="font-bold mb-3">첨부 사진</h2>

          {/* A4 한 가로줄에 2장. 각 사진은 페이지 경계에서 잘리지 않도록
              break-inside-avoid를 준다. 증빙 사진이므로 잘라내는 cover 대신
              전체가 보이는 contain을 쓴다. */}
          <div className="grid grid-cols-2 gap-4">
            {(logs || [])
              .filter((log: CareLog) => photoUrlByLogId.has(log.log_id))
              .map((log: CareLog) => (
                <figure
                  key={log.log_id}
                  className="break-inside-avoid border rounded p-2"
                >
                  {/* Supabase signed URL이라 next/image 최적화 대상이 아니다. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photoUrlByLogId.get(log.log_id)}
                    alt="간병일지 첨부 사진"
                    className="w-full h-64 object-contain"
                  />

                  <figcaption className="mt-2 text-center text-xs text-gray-700">
                    {log.care_date} · {log.writer_name || "-"}
                  </figcaption>
                </figure>
              ))}
          </div>
        </section>
      )}

      <div className="mt-6 print:hidden">
        <PrintButton />
      </div>
    </main>
  );
}