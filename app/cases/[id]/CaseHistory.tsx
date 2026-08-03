"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { CaseHistoryEntry } from "@/types/domain";

export default function CaseHistory({ caseId }: { caseId: string }) {
  const [history, setHistory] = useState<CaseHistoryEntry[]>([]);

  useEffect(() => {
    async function loadHistory() {
      const { data } = await supabase
        .from("case_history")
        .select("*")
        .eq("case_id", caseId)
        .order("created_at", { ascending: false });

      setHistory(data || []);
    }

    loadHistory();
  }, [caseId]);

  return (
    <div className="bg-white rounded-lg shadow p-5">
      <h2 className="font-bold mb-3">사례 이력</h2>

      {history.length === 0 ? (
        <p className="text-sm text-gray-500">아직 이력이 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {history.map((item) => (
            <div key={item.history_id} className="border-l-4 border-blue-500 pl-3">
              <p className="font-bold">{item.title || item.action}</p>
              <p className="text-sm text-gray-600">{item.description || "-"}</p>
              <p className="text-xs text-gray-400">
                {new Date(item.created_at).toLocaleString("ko-KR")}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}