import { Suspense } from "react";
import CaseJoinClient from "./CaseJoinClient";

export default function CaseJoinPage() {
  return (
    <Suspense fallback={<main className="p-8">불러오는 중입니다...</main>}>
      <CaseJoinClient />
    </Suspense>
  );
}
