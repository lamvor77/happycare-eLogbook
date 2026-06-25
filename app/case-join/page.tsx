"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function CaseJoinPage() {
  const [familyCode, setFamilyCode] = useState("");
  const [caregiverName, setCaregiverName] = useState("");
  const [residentNumber, setResidentNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");

    if (code) {
      setFamilyCode(code);
    }
  }, []);

  async function handleJoin() {
    if (!familyCode || !caregiverName || !phone || !relationship) {
      setMessage("필수 정보를 입력해주세요.");
      return;
    }

    setMessage("가족코드를 확인 중입니다...");

    const { data: caseData, error: caseError } = await supabase
      .from("cases")
      .select("*")
      .eq("family_code", familyCode)
      .single();

    if (caseError || !caseData) {
      setMessage("가족코드와 일치하는 환자를 찾을 수 없습니다.");
      return;
    }

    const { data: caregiver, error: caregiverError } = await supabase
      .from("caregivers")
      .insert({
        caregiver_name: caregiverName,
        resident_number: residentNumber,
        phone: phone.replaceAll("-", ""),
        otp_verified_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (caregiverError || !caregiver) {
      setMessage("간병인 등록 실패: " + caregiverError?.message);
      return;
    }

    const { error: linkError } = await supabase
      .from("case_caregivers")
      .insert({
        case_id: caseData.case_id,
        caregiver_id: caregiver.caregiver_id,
        relationship,
        is_primary_caregiver: false,
        is_current_caregiver: false,
        status: "활성",
      });

    if (linkError) {
      setMessage("가족간병인 연결 실패: " + linkError.message);
      return;
    }

    setMessage(`${caseData.patient_name} 환자 가족간병인으로 연결되었습니다.`);

    setTimeout(() => {
      window.location.href = `/cases/${caseData.case_id}`;
    }, 1200);
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow p-6 mt-10 space-y-4">
        <h1 className="text-2xl font-bold">가족간병인 참여</h1>

        <p className="text-sm text-gray-500">
          가족코드를 입력하고 본인 정보를 등록해주세요.
        </p>

        <input
          className="w-full border p-3 rounded"
          placeholder="가족코드"
          value={familyCode}
          onChange={(e) => setFamilyCode(e.target.value)}
        />

        <input
          className="w-full border p-3 rounded"
          placeholder="간병인 성명"
          value={caregiverName}
          onChange={(e) => setCaregiverName(e.target.value)}
        />

        <input
          className="w-full border p-3 rounded"
          placeholder="주민등록번호"
          value={residentNumber}
          onChange={(e) => setResidentNumber(e.target.value)}
        />

        <input
          className="w-full border p-3 rounded"
          placeholder="연락처"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />

        <select
          className="w-full border p-3 rounded"
          value={relationship}
          onChange={(e) => setRelationship(e.target.value)}
        >
          <option value="">환자와의 관계 선택</option>
          <option value="배우자">배우자</option>
          <option value="부모">부모</option>
          <option value="자녀">자녀</option>
          <option value="형제자매">형제자매</option>
          <option value="지인">지인</option>
          <option value="기타">기타</option>
        </select>

        <button
          onClick={handleJoin}
          className="w-full bg-blue-600 text-white p-4 rounded-lg font-bold"
        >
          참여하기
        </button>

        {message && <p className="text-center text-sm">{message}</p>}
      </div>
    </main>
  );
}