import { Suspense } from "react";
import CaregiverLoginClient from "./CaregiverLoginClient";

export default function CaregiverLoginPage() {
  return (
    <Suspense fallback={<main className="p-8">불러오는 중입니다...</main>}>
      <CaregiverLoginClient />
    </Suspense>
  );
}
