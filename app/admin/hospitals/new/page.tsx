import { requireAdmin } from "@/lib/admin-auth";
import NewHospitalClient from "./NewHospitalClient";

export default async function NewHospitalPage() {
  await requireAdmin();

  return <NewHospitalClient />;
}
