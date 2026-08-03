import { Suspense } from "react";
import CaseRegisterClient from "./CaseRegisterClient";

export default function CaseRegisterPage() {
  return (
    <Suspense fallback={<main className="p-8">불러오는 중입니다...</main>}>
      <CaseRegisterClient />
    </Suspense>
  );
}
