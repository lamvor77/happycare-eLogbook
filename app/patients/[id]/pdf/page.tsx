"use client";

import { use, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export default function PdfPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [message, setMessage] = useState("PDF 데이터를 불러오는 중입니다...");

  useEffect(() => {
    async function makePdf() {
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
    
      const relationshipStats =
        logs?.reduce((acc: Record<string, number>, log: any) => {
            const key = log.relationship || "미입력";
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {}) || {};

      if (!patient) {
        setMessage("환자 정보를 찾을 수 없습니다.");
        return;
      }

      const doc = new jsPDF();

      doc.setFontSize(18);
      doc.text("HappyCare Care Log", 14, 20);

      doc.setFontSize(11);
      doc.text(`Patient: ${patient.patient_name}`, 14, 35);
      doc.text(`Birth Date: ${patient.birth_date || "-"}`, 14, 43);
      doc.text(`Room: ${patient.room_no || "-"}`, 14, 51);
      doc.text(`Invite Code: ${patient.invite_code || "-"}`, 14, 59);
      doc.text("Relationship Summary", 14, 67);

        Object.entries(relationshipStats).forEach(
        ([relationship, count], index) => {
            doc.text(
            `${relationship}: ${count}회`,
            14,
            75 + index * 8
            );
        }
        );

      autoTable(doc, {
        startY: 100,
        head: [["Date", "Meal", "Move", "Toilet", "Hygiene", "Position", "Relation", "Signature"]],
        body:
          logs?.map((log) => [
            log.care_date,
            log.meal_assist ? "O" : "X",
            log.move_assist ? "O" : "X",
            log.toilet_assist ? "O" : "X",
            log.hygiene_assist ? "O" : "X",
            log.position_change ? "O" : "X",
            log.relationship || "-",
            log.signature_name || "-",
          ]) || [],
      });

      doc.save(`happycare-${patient.patient_name}.pdf`);
      setMessage("PDF 다운로드가 완료되었습니다.");
    }

    makePdf();
  }, [id]);

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-4">PDF 출력</h1>
      <p>{message}</p>
    </main>
  );
}