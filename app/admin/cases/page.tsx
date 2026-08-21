import { requireAdmin } from "@/lib/admin-auth";
import type { CaseRecord } from "@/types/domain";

function getSourceLabel(sourceType?: string | null) {
  if (sourceType === "google_form") return "구글폼";
  if (sourceType === "hospital_qr") return "병원QR";
  return "-";
}

export default async function AdminCasesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { supabase } = await requireAdmin();

  const { status, q } = await searchParams;

  let query = supabase
    .from("cases")
    .select(`
      *,
      hospitals (
        hospital_name
      )
    `)
    .order("created_at", { ascending: false });

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  if (q) {
    query = query.or(
      `patient_name.ilike.%${q}%,case_no.ilike.%${q}%,registration_no.ilike.%${q}%,room_no.ilike.%${q}%`
    );
  }

  const { data: cases, error } = await query;

  if (error) {
    return <main className="p-8">오류: {error.message}</main>;
  }

  // 사례별 "활성 간병인 연결 수"와 "동의 기록 존재 여부"를 한 번에
  // 조회한다(개인정보 원문 없이 건수/존재 여부만) — 구글폼으로 등록된
  // 사례는 caregiver/case_caregiver를 만들지 않으므로(docs/
  // registration-field-mapping.md 참고) 간병인 연결이 0건일 수 있고, 이
  // 경우 관리자에게 "간병인 연결 필요"를 알려준다.
  const caseIds = (cases || []).map((item: CaseRecord) => item.case_id);

  const activeCaregiverCountByCase = new Map<string, number>();
  const consentExistsByCase = new Set<string>();

  if (caseIds.length > 0) {
    const { data: links } = await supabase
      .from("case_caregivers")
      .select("case_id")
      .in("case_id", caseIds)
      .eq("status", "활성");

    for (const link of links || []) {
      activeCaregiverCountByCase.set(
        link.case_id,
        (activeCaregiverCountByCase.get(link.case_id) || 0) + 1
      );
    }

    const { data: consents } = await supabase
      .from("case_consents")
      .select("case_id")
      .in("case_id", caseIds);

    for (const consent of consents || []) {
      consentExistsByCase.add(consent.case_id);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-5xl mx-auto space-y-4">
        <h1 className="text-3xl font-bold">전체 사례 목록</h1>

        <form className="bg-white border rounded-lg p-4">
          <input
            name="q"
            defaultValue={q || ""}
            className="w-full border p-3 rounded mb-3"
            placeholder="환자명, 사례번호, 등록번호, 호실 검색"
          />

          <input type="hidden" name="status" value={status || "all"} />

          <button
            type="submit"
            className="w-full bg-blue-600 text-white p-3 rounded"
          >
            검색
          </button>
        </form>

        <div className="flex gap-2">
          <a href="/admin/cases?status=all" className="bg-gray-700 text-white px-3 py-2 rounded">
            전체
          </a>

          <a href="/admin/cases?status=입원중" className="bg-blue-600 text-white px-3 py-2 rounded">
            입원중
          </a>

          <a href="/admin/cases?status=간병종료" className="bg-red-600 text-white px-3 py-2 rounded">
            간병종료
          </a>
        </div>

        {cases?.map((item: CaseRecord) => {
          const activeCaregiverCount = activeCaregiverCountByCase.get(item.case_id) || 0;
          const hasConsentRecord = consentExistsByCase.has(item.case_id);
          const needsCaregiverLink =
            item.source_type === "google_form" && activeCaregiverCount === 0;

          return (
          <div key={item.case_id} className="bg-white border rounded-lg p-5 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <p className="font-bold text-lg">{item.patient_name}</p>

              {needsCaregiverLink && (
                <span className="shrink-0 bg-orange-100 text-orange-800 text-xs font-bold px-2 py-1 rounded">
                  간병인 연결 필요
                </span>
              )}
            </div>

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
              호실: {item.room_no || "-"}
            </p>

            <p className="text-sm text-gray-600">
              상태: {item.status}
            </p>

            <p className="text-sm text-gray-600">
              간병인 연결: {activeCaregiverCount}명
              {item.source_type === "hospital_qr" && (
                <> · 등록 동의 기록: {hasConsentRecord ? "있음" : "없음"}</>
              )}
            </p>

            {needsCaregiverLink && (
              <div className="mt-2 rounded border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
                <p className="font-bold">구글폼으로 등록된 사례입니다.</p>
                <p className="mt-1">
                  환자 사례는 생성되었지만, 아직 어떤 간병인과도 연결되어
                  있지 않습니다(구글폼 연동은 사례 정보만 만들 뿐 간병인을
                  연결하지 않습니다).
                </p>
                <p className="mt-1">
                  가족코드({item.family_code || "-"})를 안내해 가족간병인이
                  /case-join 화면으로 직접 참여하게 하거나, 관리자가 대신
                  연결해야 합니다 — 현재 관리자가 대신 연결하는 전용 기능은
                  없어 후속 과제로 남아 있습니다.
                </p>
              </div>
            )}

            <div className="flex gap-2 mt-3">
              <a
                href={`/cases/${item.case_id}`}
                className="bg-blue-600 text-white px-3 py-2 rounded text-sm"
              >
                사례 보기
              </a>

              <a
                href={`/admin/cases/${item.case_id}/print`}
                className="bg-purple-600 text-white px-3 py-2 rounded text-sm"
              >
                PDF 출력
              </a>

              <a
                href={`/admin/cases/${item.case_id}/care-logs`}
                className="bg-gray-700 text-white px-3 py-2 rounded text-sm"
              >
                간병일지 관리
              </a>

              <a
                href={`/admin/test-reset?caseId=${item.case_id}`}
                className="bg-red-100 text-red-800 px-3 py-2 rounded text-sm font-bold"
              >
                테스트 초기화
              </a>
            </div>
          </div>
          );
        })}

        {(!cases || cases.length === 0) && (
          <div className="bg-white border rounded-lg p-5 text-gray-700">
            검색 결과가 없습니다.
          </div>
        )}
      </div>
    </main>
  );
}