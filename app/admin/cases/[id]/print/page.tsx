import { requireAdmin } from "@/lib/admin-auth";
import PrintButton from "./PrintButton";

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

  const { data: logs, error: logsError } = await supabase
    .from("care_logs")
    .select(`
      *,
      caregivers (
        caregiver_name,
        phone
      )
    `)
    .eq("case_id", id)
    .order("care_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (logsError) {
    return (
      <main className="p-8">
        간병일지 조회 오류: {logsError.message}
      </main>
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  const documentNo = `HG-${
    caseData.case_no || caseData.case_id.slice(0, 8)
  }-${today.replaceAll("-", "")}`;

  return (
    <main className="p-6 md:p-8 max-w-6xl mx-auto bg-white">
      <header className="mb-6 text-center">
        <h1 className="text-3xl font-bold">
          가족간병 통합 간병일지
        </h1>

        <p className="mt-2 text-sm text-gray-500">
          문서번호: {documentNo}
        </p>
      </header>

      <section className="mb-6 border rounded p-4">
        <h2 className="font-bold mb-3">병원 및 환자 정보</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
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

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] border-collapse border text-xs">
            <thead>
              <tr>
                <th className="border p-2">간병일자</th>
                <th className="border p-2">작성일시</th>
                <th className="border p-2">작성자</th>
                <th className="border p-2">관계</th>
                <th className="border p-2">식사</th>
                <th className="border p-2">이동</th>
                <th className="border p-2">배설</th>
                <th className="border p-2">위생</th>
                <th className="border p-2">체위</th>
                <th className="border p-2">위치 확인</th>
                <th className="border p-2">위치 확인 시간</th>
                <th className="border p-2">미기록 사유</th>
                <th className="border p-2">전자서명</th>
                <th className="border p-2">특이사항</th>
              </tr>
            </thead>

            <tbody>
              {logs && logs.length > 0 ? (
                logs.map((log: any) => {
                  const locationChecked =
                    log.location_status === "checked";

                  return (
                    <tr key={log.log_id}>
                      <td className="border p-2 text-center">
                        {log.care_date || "-"}
                      </td>

                      <td className="border p-2">
                        {log.created_at
                          ? new Date(log.created_at).toLocaleString(
                              "ko-KR"
                            )
                          : "-"}
                      </td>

                      <td className="border p-2">
                        {log.writer_name ||
                          log.signature_name ||
                          log.caregivers?.caregiver_name ||
                          "-"}
                      </td>

                      <td className="border p-2">
                        {log.relationship || "-"}
                      </td>

                      <td className="border p-2 text-center">
                        {log.meal_assist ? "O" : "X"}
                      </td>

                      <td className="border p-2 text-center">
                        {log.move_assist ? "O" : "X"}
                      </td>

                      <td className="border p-2 text-center">
                        {log.toilet_assist ? "O" : "X"}
                      </td>

                      <td className="border p-2 text-center">
                        {log.hygiene_assist ? "O" : "X"}
                      </td>

                      <td className="border p-2 text-center">
                        {log.position_change ? "O" : "X"}
                      </td>

                      <td className="border p-2 text-center">
                        {locationChecked ? "확인 완료" : "미기록"}
                      </td>

                      <td className="border p-2">
                        {log.location_checked_at
                          ? new Date(
                              log.location_checked_at
                            ).toLocaleString("ko-KR")
                          : "-"}
                      </td>

                      <td className="border p-2">
                        {locationChecked
                          ? "-"
                          : getLocationFailureLabel(
                              log.location_failure_reason
                            )}
                      </td>

                      <td className="border p-2">
                        {log.signature_name ||
                          log.writer_name ||
                          "-"}
                      </td>

                      <td className="border p-2">
                        {log.memo || "-"}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan={14}
                    className="border p-6 text-center text-gray-500"
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

      <div className="mt-6 print:hidden">
        <PrintButton />
      </div>
    </main>
  );
}