import { requireCaregiverPage } from "@/lib/caregiver-auth";

interface MyCaseLink {
  case_caregiver_id: string;
  relationship: string;
  is_current_caregiver: boolean;
  status: string;
  cases?: {
    case_id: string;
    case_no: string | null;
    patient_name: string;
    room_no: string | null;
    status: string;
    hospitals?: { hospital_name: string } | null;
  } | null;
}

export default async function MyCasesPage() {
  const { supabase, caregiver } = await requireCaregiverPage();

  const { data: linksData } = await supabase
    .from("case_caregivers")
    .select(
      `
      case_caregiver_id,
      relationship,
      is_current_caregiver,
      status,
      cases (
        case_id,
        case_no,
        patient_name,
        room_no,
        status,
        hospitals ( hospital_name )
      )
    `
    )
    .eq("caregiver_id", caregiver.caregiver_id)
    .eq("status", "활성");

  // Supabase가 다대일 관계(cases)를 배열로 추론하지만 실제로는 단일
  // 객체다(app/cases/[id]/care-logs/page.tsx의 hospitals 케이스와 동일한
  // 이유). 최소 타입으로 명시적으로 재단언한다.
  const links = linksData as unknown as MyCaseLink[] | null;

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto space-y-4">
        <div className="bg-white rounded-lg shadow p-5">
          <h1 className="text-2xl font-bold">내 사례</h1>
          <p className="text-gray-600 mt-2">
            {caregiver.caregiver_name}님과 연결된 사례입니다.
          </p>
        </div>

        {links && links.length > 0 ? (
          links.map((link: MyCaseLink) => (
            <a
              key={link.case_caregiver_id}
              href={`/cases/${link.cases?.case_id}`}
              className="block bg-white border rounded-lg p-5 shadow-sm"
            >
              <p className="font-bold text-lg">{link.cases?.patient_name}</p>
              <p className="text-sm text-gray-600">
                사례번호: {link.cases?.case_no || "-"}
              </p>
              <p className="text-sm text-gray-600">
                병원: {link.cases?.hospitals?.hospital_name || "-"}
              </p>
              <p className="text-sm text-gray-600">
                호실: {link.cases?.room_no || "-"} / 상태: {link.cases?.status}
              </p>
              <p className="text-sm text-gray-600">
                관계: {link.relationship}
                {link.is_current_caregiver ? " (현재 간병인)" : ""}
              </p>
            </a>
          ))
        ) : (
          <div className="bg-white border rounded-lg p-5 text-gray-500 text-center space-y-3">
            <p>연결된 사례가 없습니다.</p>
            <p className="text-sm">
              병원 QR을 스캔해 최초 등록을 하거나, 가족에게 받은 가족코드로
              참여해주세요.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
