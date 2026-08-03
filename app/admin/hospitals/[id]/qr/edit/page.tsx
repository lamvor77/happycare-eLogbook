import { requireAdmin } from "@/lib/admin-auth";
import EditHospitalClient from "./EditHospitalClient";

export default async function EditHospitalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();

  return <EditHospitalClient params={params} />;
}
