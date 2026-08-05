import { requireAdmin } from "@/lib/admin-auth";
import type { CareLog } from "@/types/domain";

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

export default async function LocationUnavailablePage() {
  const { supabase } = await requireAdmin();

  // care_logs.caregiver_id는 DB에 caregivers를 향한 FK가 없어 PostgREST가
  // 관계를 추론하지 못한다(PGRST200) — cases(...)는 실제 FK가 있는 정상
  // 관계라 그대로 둔다. 이 화면은 위치 미기록 건을 관리자가 직접 연락해
  // 확인해야 할 수 있어 전화번호가 실제로 필요하므로, caregivers는 embed
  // 대신 caregiver_id 목록으로 별도 조회한 뒤 Map으로 결합한다.
  const { data: logs, error } = await supabase
    .from("care_logs")
    .select(`
      *,
      cases (
        case_id,
        case_no,
        patient_name,
        room_no,
        hospitals (
          hospital_name
        )
      )
    `)
    .eq("location_status", "unavailable")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(
      "위치 미기록 간병일지 조회 실패:",
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
        위치 미기록 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.
      </main>
    );
  }

  const caregiverIds = Array.from(
    new Set((logs || []).map((log) => log.caregiver_id).filter(Boolean))
  );

  const caregiverPhoneMap = new Map<string, string | null>();

  if (caregiverIds.length > 0) {
    const { data: caregiversData, error: caregiversError } = await supabase
      .from("caregivers")
      .select("caregiver_id, phone")
      .in("caregiver_id", caregiverIds);

    if (caregiversError) {
      console.error(
        "간병인 연락처 조회 실패:",
        caregiversError.message,
        "code:",
        caregiversError.code,
        "details:",
        caregiversError.details,
        "hint:",
        caregiversError.hint
      );
    } else {
      for (const caregiver of caregiversData || []) {
        caregiverPhoneMap.set(caregiver.caregiver_id, caregiver.phone);
      }
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">
            위치 미기록 간병일지
          </h1>

          <p className="mt-2 text-sm text-gray-600">
            위치 확인을 시도했지만 확인할 수 없었던 기록입니다.
          </p>
        </div>

        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">
            총 미기록 건수:{" "}
            <span className="font-bold">
              {logs?.length || 0}건
            </span>
          </p>
        </div>

        <div className="space-y-4">
          {logs && logs.length > 0 ? (
            logs.map((log: CareLog) => (
              <div
                key={log.log_id}
                className="rounded-lg border bg-white p-5 shadow-sm"
              >
                <div className="flex flex-col gap-1">
                  <p className="text-lg font-bold">
                    {log.cases?.patient_name || "-"}
                  </p>

                  <p className="text-sm text-gray-600">
                    사례번호: {log.cases?.case_no || "-"}
                  </p>

                  <p className="text-sm text-gray-600">
                    병원:{" "}
                    {log.cases?.hospitals?.hospital_name || "-"}
                  </p>

                  <p className="text-sm text-gray-600">
                    입원호실: {log.cases?.room_no || "-"}
                  </p>
                </div>

                <div className="mt-4 rounded border bg-gray-50 p-3 text-sm">
                  <p>간병일자: {log.care_date || "-"}</p>

                  <p>
                    작성일시:{" "}
                    {log.created_at
                      ? new Date(log.created_at).toLocaleString(
                          "ko-KR"
                        )
                      : "-"}
                  </p>

                  <p>
                    작성자:{" "}
                    {log.writer_name || log.signature_name || "-"}
                  </p>

                  <p>관계: {log.relationship || "-"}</p>

                  <p>
                    연락처: {caregiverPhoneMap.get(log.caregiver_id) || "-"}
                  </p>
                </div>

                <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <p className="font-bold">
                    위치 확인 결과: 미기록
                  </p>

                  <p className="mt-1">
                    미기록 사유:{" "}
                    {getLocationFailureLabel(
                      log.location_failure_reason
                    )}
                  </p>

                  <p className="mt-1">
                    위치 확인 시도시간:{" "}
                    {log.location_checked_at
                      ? new Date(
                          log.location_checked_at
                        ).toLocaleString("ko-KR")
                      : "-"}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {log.case_id && (
                    <a
                      href={`/cases/${log.case_id}`}
                      className="rounded bg-blue-600 px-3 py-2 text-sm text-white"
                    >
                      사례 보기
                    </a>
                  )}

                  {log.case_id && (
                    <a
                      href={`/cases/${log.case_id}/care-logs`}
                      className="rounded bg-gray-700 px-3 py-2 text-sm text-white"
                    >
                      통합 간병일지 보기
                    </a>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-lg border bg-white p-6 text-center text-gray-700">
              위치 미기록 간병일지가 없습니다.
            </div>
          )}
        </div>

        <a
          href="/admin"
          className="inline-block rounded bg-gray-700 px-4 py-3 text-white"
        >
          관리자 대시보드로 돌아가기
        </a>
      </div>
    </main>
  );
}