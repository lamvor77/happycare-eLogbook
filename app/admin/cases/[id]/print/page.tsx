import { supabase } from "@/lib/supabase";
import PrintButton from "@/app/patients/[id]/print/PrintButton";

export default async function AdminCasePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: caseData } = await supabase
    .from("cases")
    .select(`
      *,
      hospitals (
        hospital_name,
        hospital_address
      )
    `)
    .eq("case_id", id)
    .single();

  const { data: logs } = await supabase
    .from("care_logs")
    .select("*")
    .eq("case_id", id)
    .order("care_date", { ascending: true });

  if (!caseData) {
    return <main className="p-8">사례 정보를 찾을 수 없습니다.</main>;
  }

  const documentNo = `HG-${caseData.case_id.slice(0, 8)}-${new Date()
    .toISOString()
    .slice(0, 10)
    .replaceAll("-", "")}`;

  return (
    <main className="p-8 max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">
        가족간병 통합 간병일지
      </h1>

      <p className="text-sm text-gray-500 mb-6">
        문서번호: {documentNo}
      </p>

      <div className="mb-6 border rounded p-4">
        <p>병원명: {caseData.hospitals?.hospital_name || "-"}</p>
        <p>병원주소: {caseData.hospitals?.hospital_address || "-"}</p>
        <p>환자명: {caseData.patient_name}</p>
        <p>생년월일: {caseData.patient_birth_date || "-"}</p>
        <p>입원호실: {caseData.room_no || "-"}</p>
        <p>진단명: {caseData.diagnosis_name || "-"}</p>
        <p>보험사: {caseData.insurance_company || "-"}</p>
        <p>간병기간: {caseData.care_start_date || "-"} ~ {caseData.care_end_date || "-"}</p>
      </div>

      <table className="w-full border-collapse border text-sm">
        <thead>
          <tr>
            <th className="border p-2">작성일</th>
            <th className="border p-2">작성자</th>
            <th className="border p-2">관계</th>
            <th className="border p-2">식사</th>
            <th className="border p-2">이동</th>
            <th className="border p-2">배설</th>
            <th className="border p-2">위생</th>
            <th className="border p-2">체위</th>
            <th className="border p-2">위치</th>
            <th className="border p-2">특이사항</th>
          </tr>
        </thead>

        <tbody>
          {logs?.map((log: any) => (
            <tr key={log.log_id}>
              <td className="border p-2">{log.care_date}</td>
              <td className="border p-2">{log.writer_name || log.signature_name || "-"}</td>
              <td className="border p-2">{log.relationship || "-"}</td>
              <td className="border p-2">{log.meal_assist ? "O" : "X"}</td>
              <td className="border p-2">{log.move_assist ? "O" : "X"}</td>
              <td className="border p-2">{log.toilet_assist ? "O" : "X"}</td>
              <td className="border p-2">{log.hygiene_assist ? "O" : "X"}</td>
              <td className="border p-2">{log.position_change ? "O" : "X"}</td>
              <td className="border p-2">{log.location_status === "checked" ? "확인" : "미사용"}</td>
              <td className="border p-2">{log.memo || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-8 text-sm">
        <p>본 문서는 해피간병 시스템에서 생성된 가족간병 전자기록입니다.</p>
        <p>문서번호: {documentNo}</p>
      </div>

      <PrintButton />
    </main>
  );
}