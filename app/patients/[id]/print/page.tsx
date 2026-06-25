import PrintButton from "./PrintButton";
import { supabase } from "@/lib/supabase";

export default async function PrintPage({
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

  const { data: logs } = await supabase
    .from("care_logs")
    .select("*")
    .eq("patient_id", id)
    .order("care_date", { ascending: true });

  if (!patient) {
    return <main className="p-8">환자를 찾을 수 없습니다.</main>;
  }

  const documentNo = `HG-${patient.patient_id.slice(0, 8)}-${new Date()
  .toISOString()
  .slice(0, 10)
  .replaceAll("-", "")}`;

  return (
    <main className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">가족간병 전자일지</h1>
      <p className="mb-6 text-sm text-gray-600">
        문서번호: {documentNo}
      </p>

      <div className="mb-6">
        <p>환자명: {patient.patient_name}</p>
        <p>생년월일: {patient.birth_date}</p>
        <p>병실: {patient.room_no}</p>
        <p>초대코드: {patient.invite_code}</p>
      </div>
      <div className="mb-6 border rounded p-4">
        <p>총 작성일수: {logs?.length || 0}일</p>
        <p>출력일시: {new Date().toLocaleString("ko-KR")}</p>
        </div>

        <p className="mb-6 text-sm text-gray-600">
        본 문서는 보호자 또는 가족이 직접 작성한 가족간병 전자일지이며,
        병원의 진료기록 또는 간호기록을 대체하지 않습니다.
        </p>

      <table className="w-full border-collapse border">
        <thead>
          <tr>
            <th className="border p-2">작성시간</th>
            <th className="border p-2">일자</th>
            <th className="border p-2">식사</th>
            <th className="border p-2">이동</th>
            <th className="border p-2">배설</th>
            <th className="border p-2">위생</th>
            <th className="border p-2">체위</th>
            <th className="border p-2">관계</th>
            <th className="border p-2">서명</th>
            <th className="border p-2">위치확인</th>
          </tr>
        </thead>
        <tbody>
          {logs?.map((log) => (
            <tr key={log.log_id}>
              <td className="border p-2">
                {log.created_at
                    ? new Date(log.created_at).toLocaleString("ko-KR")
                    : "-"}
                </td>  
              <td className="border p-2">{log.care_date}</td>
              <td className="border p-2">{log.meal_assist ? "O" : "X"}</td>
              <td className="border p-2">{log.move_assist ? "O" : "X"}</td>
              <td className="border p-2">{log.toilet_assist ? "O" : "X"}</td>
              <td className="border p-2">{log.hygiene_assist ? "O" : "X"}</td>
              <td className="border p-2">{log.position_change ? "O" : "X"}</td>
              <td className="border p-2">{log.relationship || "-"}</td>
              <td className="border p-2">{log.signature_name || "-"}</td>
              <td className="border p-2">
              {log.location_status === "checked" ? "확인" : "미사용"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
        <div className="mt-8 text-sm">
        <p>위 기록은 작성자가 전자서명한 간병활동 기록입니다.</p>
        <p>해피간병 시스템 생성 문서 / 문서번호: {documentNo}</p>
        </div>
      <PrintButton />
    </main>
  );
}