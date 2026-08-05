import type { CaseHistoryEntry } from "@/types/domain";

/**
 * 순수 표시 전용 컴포넌트다. case_history 조회는 부모(app/cases/[id]/page.tsx)가
 * requireCaseMemberSession()으로 권한을 확인한 뒤, 그 세션의 service_role
 * 클라이언트로 이미 수행한다 — 여기서는 별도로 다시 조회하거나 세션을
 * 검증하지 않는다(중복 검증 방지, 권한 확인이 항상 조회보다 먼저 실행됨을
 * 명확히 유지).
 */
export default function CaseHistory({
  history,
  loadError,
}: {
  history: CaseHistoryEntry[] | null;
  loadError: boolean;
}) {
  return (
    <div className="bg-white rounded-lg shadow p-5">
      <h2 className="font-bold mb-3">사례 이력</h2>

      {loadError ? (
        <p className="text-sm text-red-600">사례 이력을 불러오지 못했습니다.</p>
      ) : !history || history.length === 0 ? (
        <p className="text-sm text-gray-700">아직 등록된 사례 이력이 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {history.map((item) => (
            <div
              key={item.history_id}
              className="border-l-4 border-blue-500 pl-3"
            >
              <p className="font-bold">
                {item.title || item.action || item.history_type}
              </p>

              {item.description && (
                <p className="text-sm text-gray-700">{item.description}</p>
              )}

              <p className="text-xs text-gray-700">
                {item.actor ? `수행자: ${item.actor} · ` : ""}
                {new Date(item.created_at).toLocaleString("ko-KR")}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
