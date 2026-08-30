import { requireAdmin } from "@/lib/admin-auth";
import LogoutButton from "./LogoutButton";
import RecentCaseTestResetButton from "./RecentCaseTestResetButton";
import type { CaseRecord, CareLog } from "@/types/domain";
import { CARE_LOG_PHOTO_BUCKET } from "@/lib/care-log-photo";

function getSourceLabel(sourceType?: string | null) {
  if (sourceType === "google_form") return "구글폼";
  if (sourceType === "hospital_qr") return "병원QR";
  return "-";
}

export default async function AdminPage() {
  const { supabase, email } = await requireAdmin();

  const { count: caseCount } = await supabase
    .from("cases")
    .select("*", { count: "exact", head: true });

  const { count: activeCaseCount } = await supabase
    .from("cases")
    .select("*", { count: "exact", head: true })
    .eq("status", "입원중");

  // 삭제된(soft delete) 간병일지는 일반 운영 통계에 포함하지 않는다 —
  // 아래 care_logs 집계에는 모두 deleted_at is null 조건을 붙인다. 삭제된
  // 일지 자체를 확인하려면 사례별 "관리자 간병일지 관리" 화면의 "삭제된
  // 일지 포함" 필터를 사용한다.
  const { count: careLogCount } = await supabase
    .from("care_logs")
    .select("*", { count: "exact", head: true })
    .is("deleted_at", null);

  const { count: caregiverCount } = await supabase
    .from("caregivers")
    .select("*", { count: "exact", head: true });

  const today = new Date().toISOString().slice(0, 10);

  const { count: todayCareLogCount } = await supabase
    .from("care_logs")
    .select("*", { count: "exact", head: true })
    .eq("care_date", today)
    .is("deleted_at", null);

  const { count: checkedLocationCount } = await supabase
    .from("care_logs")
    .select("*", { count: "exact", head: true })
    .eq("location_status", "checked")
    .is("deleted_at", null);

  const { count: unavailableLocationCount } = await supabase
    .from("care_logs")
    .select("*", { count: "exact", head: true })
    .eq("location_status", "unavailable")
    .is("deleted_at", null);

  // 기존 데이터 중 위치 확인이 선택사항이던 시기의 기록
  const { count: legacyNotUsedCount } = await supabase
    .from("care_logs")
    .select("*", { count: "exact", head: true })
    .eq("location_status", "not_used")
    .is("deleted_at", null);

  const totalLogs = careLogCount || 0;
  const checkedLogs = checkedLocationCount || 0;
  const unavailableLogs = unavailableLocationCount || 0;
  const legacyLogs = legacyNotUsedCount || 0;

  const locationRate =
    totalLogs > 0
      ? Math.round((checkedLogs / totalLogs) * 100)
      : 0;

  const { data: recentCases } = await supabase
    .from("cases")
    .select(`
      *,
      hospitals (
        hospital_name
      )
    `)
    .order("created_at", { ascending: false })
    .limit(10);

  const { data: recentLogs } = await supabase
    .from("care_logs")
    .select(`
      *,
      cases (
        patient_name,
        room_no,
        case_no
      )
    `)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(10);

  // 최근 일지에 첨부된 사진. private 버킷이라 공개 URL이 없어, 화면을 그릴
  // 때 짧은 유효기간의 signed URL을 발급한다. 여기 표시되는 10건에 대해서만
  // 조회한다.
  const photoUrlByLogId = new Map<string, string>();
  const recentLogIds = (recentLogs || []).map((log: CareLog) => log.log_id);

  if (recentLogIds.length > 0) {
    const { data: photos } = await supabase
      .from("care_log_photos")
      .select("log_id, file_url")
      .in("log_id", recentLogIds);

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

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">
            관리자 대시보드
          </h1>

          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-700">{email}</span>
            <LogoutButton />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <a
            href="/admin/cases"
            className="bg-blue-600 text-white px-4 py-2 rounded"
          >
            전체 사례 목록
          </a>

          <a
            href="/admin/hospitals"
            className="bg-green-600 text-white px-4 py-2 rounded"
          >
            병원관리
          </a>

          <a
            href="/admin/location-unavailable"
            className="bg-red-600 text-white px-4 py-2 rounded"
          >
            위치 미기록 보기
          </a>

          <a
            href="/admin/test-reset"
            className="bg-gray-700 text-white px-4 py-2 rounded"
          >
            테스트 데이터 초기화
          </a>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white border rounded-lg p-5">
            <p className="text-sm text-gray-700">전체 사례</p>
            <p className="text-3xl font-bold">
              {caseCount || 0}
            </p>
          </div>

          <div className="bg-white border rounded-lg p-5">
            <p className="text-sm text-gray-700">입원중 사례</p>
            <p className="text-3xl font-bold">
              {activeCaseCount || 0}
            </p>
          </div>

          <div className="bg-white border rounded-lg p-5">
            <p className="text-sm text-gray-700">간병일지</p>
            <p className="text-3xl font-bold">
              {totalLogs}
            </p>
          </div>

          <div className="bg-white border rounded-lg p-5">
            <p className="text-sm text-gray-700">가족간병인</p>
            <p className="text-3xl font-bold">
              {caregiverCount || 0}
            </p>
          </div>

          <div className="bg-white border rounded-lg p-5">
            <p className="text-sm text-gray-700">오늘 작성</p>
            <p className="text-3xl font-bold">
              {todayCareLogCount || 0}
            </p>
          </div>

          <div className="bg-white border rounded-lg p-5">
            <p className="text-sm text-gray-700">위치 확인 완료</p>
            <p className="text-3xl font-bold">
              {checkedLogs}
            </p>
          </div>

          <div className="bg-white border rounded-lg p-5">
            <p className="text-sm text-gray-700">위치 미기록</p>
            <p className="text-3xl font-bold">
              {unavailableLogs}
            </p>
          </div>

          <div className="bg-white border rounded-lg p-5">
            <p className="text-sm text-gray-700">위치 확인률</p>
            <p className="text-3xl font-bold">
              {locationRate}%
            </p>
          </div>
        </div>

        {legacyLogs > 0 && (
          <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-sm">
            <p className="font-bold text-yellow-800">
              기존 위치 미사용 기록: {legacyLogs}건
            </p>

            <p className="mt-1 text-yellow-700">
              위치 확인이 선택사항이던 기존 기록입니다. 새 기록부터는
              확인 완료 또는 확인 불가 사유로 저장됩니다.
            </p>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          <section className="bg-white rounded-lg shadow p-5">
            <h2 className="text-xl font-bold mb-4">
              최근 등록 사례
            </h2>

            <div className="space-y-3">
              {recentCases && recentCases.length > 0 ? (
                recentCases.map((item: CaseRecord) => (
                  <div
                    key={item.case_id}
                    className="border rounded p-3"
                  >
                    <a
                      href={`/cases/${item.case_id}`}
                      className="block"
                    >
                      <p className="font-bold">
                        {item.patient_name}
                      </p>

                      <p className="text-sm text-gray-600">
                        사례번호: {item.case_no || "-"}
                      </p>

                      <p className="text-sm text-gray-600">
                        등록번호: {item.registration_no || "-"}
                      </p>

                      <p className="text-sm text-gray-600">
                        유입경로: {getSourceLabel(item.source_type)}
                      </p>

                      <p className="text-sm text-gray-600">
                        병원: {item.hospitals?.hospital_name || "-"}
                      </p>

                      <p className="text-sm text-gray-600">
                        호실: {item.room_no || "-"} / 상태:{" "}
                        {item.status || "-"}
                      </p>
                    </a>

                    <a
                      href={`/admin/cases/${item.case_id}/print`}
                      className="inline-block mt-3 bg-purple-600 text-white px-3 py-2 rounded text-sm"
                    >
                      PDF 출력
                    </a>

                    <RecentCaseTestResetButton caseId={item.case_id} />
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-700">
                  등록된 사례가 없습니다.
                </p>
              )}
            </div>
          </section>

          <section className="bg-white rounded-lg shadow p-5">
            <h2 className="text-xl font-bold mb-4">
              최근 간병일지
            </h2>

            <div className="space-y-3">
              {recentLogs && recentLogs.length > 0 ? (
                recentLogs.map((log: CareLog) => {
                  const locationChecked =
                    log.location_status === "checked";

                  const locationUnavailable =
                    log.location_status === "unavailable";

                  return (
                    <div
                      key={log.log_id}
                      className="border rounded p-3"
                    >
                      <p className="font-bold">
                        {log.cases?.patient_name || "-"} /{" "}
                        {log.cases?.room_no || "-"}
                      </p>

                      <p className="text-sm text-gray-600">
                        사례번호: {log.cases?.case_no || "-"}
                      </p>

                      <p className="text-sm">
                        작성일: {log.care_date || "-"}
                      </p>

                      <p className="text-sm">
                        작성자:{" "}
                        {log.writer_name ||
                          log.signature_name ||
                          "-"}
                      </p>

                      <p className="text-sm">
                        관계: {log.relationship || "-"}
                      </p>

                      <div
                        className={`mt-2 rounded p-2 text-sm ${
                          locationChecked
                            ? "bg-green-50 text-green-700"
                            : "bg-red-50 text-red-700"
                        }`}
                      >
                        {locationChecked && (
                          <p>위치확인: 확인 완료</p>
                        )}

                        {locationUnavailable && (
                          <>
                            <p>위치확인: 미기록</p>
                            <p className="text-xs mt-1">
                              사유:{" "}
                              {log.location_failure_reason || "확인 불가"}
                            </p>
                          </>
                        )}

                        {!locationChecked &&
                          !locationUnavailable && (
                            <p>
                              위치확인: 기존 미사용 기록
                            </p>
                          )}
                      </div>

                      {photoUrlByLogId.has(log.log_id) && (
                        <div className="mt-3">
                          <p className="text-sm text-gray-700 mb-1">
                            첨부 사진
                          </p>

                          {/* Supabase signed URL이라 next/image 최적화 대상이 아니다. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photoUrlByLogId.get(log.log_id)}
                            alt="간병일지 첨부 사진"
                            className="w-full max-h-56 object-contain rounded border"
                          />
                        </div>
                      )}

                      <a
                        href={`/cases/${log.case_id}`}
                        className="inline-block mt-3 bg-blue-600 text-white px-3 py-2 rounded text-sm"
                      >
                        사례 보기
                      </a>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-gray-700">
                  작성된 간병일지가 없습니다.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}