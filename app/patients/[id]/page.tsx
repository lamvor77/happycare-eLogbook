import { supabase } from "@/lib/supabase";
import CopyInviteButton from "./CopyInviteButton";
import QRCodeBox from "./QRCodeBox";

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: patient } = await supabase
    .from("patients")
    .select("*")
    .eq("patient_id", id)
    .single();

  const { data: careLogs } = await supabase
    .from("care_logs")
    .select("*")
    .eq("patient_id", id)
    .order("care_date", { ascending: false });

  const { data: members } = await supabase
    .from("patient_members")
    .select("*")
    .eq("patient_id", id);

  const relationshipStats =
    careLogs?.reduce((acc: Record<string, number>, log) => {
      const key = log.relationship || "미입력";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}) || {};

  if (!patient) {
    return <main className="p-8">환자를 찾을 수 없습니다.</main>;
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto space-y-4">
        <div className="bg-white rounded-lg shadow p-5">
          <h1 className="text-2xl font-bold mb-4">{patient.patient_name}</h1>

          <div className="space-y-2 text-gray-700">
            <p>병실: {patient.room_no || "-"}</p>
            <p>생년월일: {patient.birth_date || "-"}</p>
            <p>
              초대코드: {patient.invite_code}
              <CopyInviteButton inviteCode={patient.invite_code} />
            </p>
          </div>
        </div>

        <QRCodeBox inviteCode={patient.invite_code} />

        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white border rounded-lg p-3 text-center">
            <p className="text-xs text-gray-500">총 작성일수</p>
            <p className="text-xl font-bold">{careLogs?.length || 0}</p>
          </div>

          <div className="bg-white border rounded-lg p-3 text-center">
            <p className="text-xs text-gray-500">최근 작성일</p>
            <p className="font-bold text-sm">{careLogs?.[0]?.care_date || "-"}</p>
          </div>

          <div className="bg-white border rounded-lg p-3 text-center">
            <p className="text-xs text-gray-500">참여 가족</p>
            <p className="text-xl font-bold">{members?.length || 0}</p>
          </div>
        </div>

        <div className="bg-white border rounded-lg p-5">
          <h2 className="font-bold mb-3">관계별 작성 현황</h2>

          <div className="space-y-2 text-sm">
            {Object.entries(relationshipStats).length > 0 ? (
              Object.entries(relationshipStats).map(([relationship, count]) => (
                <p key={relationship}>
                  {relationship}: {count}회
                </p>
              ))
            ) : (
              <p className="text-gray-500">아직 작성 기록이 없습니다.</p>
            )}
          </div>
        </div>

        <div className="bg-white border rounded-lg p-5">
          <h2 className="font-bold mb-3">참여 가족 목록</h2>

          <div className="space-y-2 text-sm">
            {members && members.length > 0 ? (
              members.map((member) => (
                <p key={member.member_id}>관계: {member.relationship}</p>
              ))
            ) : (
              <p className="text-gray-500">아직 참여 가족이 없습니다.</p>
            )}
          </div>
        </div>

        <div className="bg-white border rounded-lg p-5">
          <h2 className="font-bold mb-3">최근 간병일지</h2>

          <div className="space-y-3 text-sm">
            {careLogs?.slice(0, 3).map((log) => (
              <div key={log.log_id} className="border rounded p-3">
                <p className="font-bold">{log.care_date}</p>
                <p>관계: {log.relationship || "-"}</p>
                <p>작성자: {log.signature_name || "-"}</p>
                <p>특이사항: {log.memo || "-"}</p>
              </div>
            ))}

            {(!careLogs || careLogs.length === 0) && (
              <p className="text-gray-500">아직 작성된 간병일지가 없습니다.</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 pb-8">
          <a
            href={`/care-log/${patient.patient_id}`}
            className="text-center bg-blue-600 text-white px-4 py-3 rounded"
          >
            간병일지 작성
          </a>

          <a
            href={`/patients/${patient.patient_id}/care-logs`}
            className="text-center bg-gray-700 text-white px-4 py-3 rounded"
          >
            작성기록 보기
          </a>
          
        </div>
      </div>
    </main>
  );
}