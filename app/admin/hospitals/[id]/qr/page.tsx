import { requireAdmin } from "@/lib/admin-auth";
import HospitalQrClient from "./HospitalQrClient";

export default async function HospitalQrPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();

  return <HospitalQrClient params={params} />;
}
