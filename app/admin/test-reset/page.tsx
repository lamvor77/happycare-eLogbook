import { requireAdmin } from "@/lib/admin-auth";
import TestResetClient from "./TestResetClient";

/**
 * 테스트/QA 전용 데이터 초기화 화면. 화면 진입만으로는 아무것도 삭제하지
 * 않는다 — 반드시 [삭제 대상 확인](Preview) → 확인문구 "RESET" 입력 →
 * 확인 모달까지 통과해야 실행된다.
 */
export default async function AdminTestResetPage({
  searchParams,
}: {
  searchParams: Promise<{ caseId?: string }>;
}) {
  const { supabase } = await requireAdmin();

  const { caseId } = await searchParams;

  // 병원 기준 초기화는 자유 입력 대신 목록에서 고르게 한다.
  const { data: hospitals } = await supabase
    .from("hospitals")
    .select("hospital_id, hospital_name")
    .order("created_at", { ascending: false });

  // 사례 기준 초기화는 관리자 사례 목록의 [테스트 초기화] 링크로만 들어온다
  // (case_id 자유 입력 금지). 링크로 들어온 경우 어떤 사례인지 확인용으로만
  // 최소 정보를 보여준다.
  let initialCaseLabel: string | null = null;

  if (caseId) {
    const { data: caseRow } = await supabase
      .from("cases")
      .select("case_no, status")
      .eq("case_id", caseId)
      .maybeSingle();

    initialCaseLabel = caseRow
      ? `${caseRow.case_no || caseId.slice(0, 8)} (${caseRow.status})`
      : null;
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 text-gray-900">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4">
          <h1 className="text-2xl font-bold text-red-800">테스트 데이터 초기화</h1>
          <p className="mt-2 text-sm font-bold text-red-700">
            테스트/QA 목적으로만 사용하세요. 삭제된 데이터는 복구되지 않을 수
            있습니다.
          </p>
          <p className="mt-1 text-sm text-red-700">
            이 화면의 삭제는 일반 관리자 기능(간병일지 소프트 삭제)과 달리
            되돌릴 수 없는 하드 삭제입니다.
          </p>
        </div>

        <TestResetClient
          hospitals={hospitals || []}
          initialCaseId={caseId || null}
          initialCaseLabel={initialCaseLabel}
        />

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
