"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function CaseRegisterPage() {
  const [hospitalCode, setHospitalCode] = useState("");
  const [hospitalId, setHospitalId] = useState("");

  const [caregiverName, setCaregiverName] = useState("");
  const [residentNumber, setResidentNumber] = useState("");
  const [caregiverPhone, setCaregiverPhone] = useState("");

  const [patientName, setPatientName] = useState("");
  const [patientBirthDate, setPatientBirthDate] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [patientGender, setPatientGender] = useState("");
  const [relationship, setRelationship] = useState("");
  const [diagnosisName, setDiagnosisName] = useState("");
  const [roomNo, setRoomNo] = useState("");

  const [insuranceCompany, setInsuranceCompany] = useState("");
  const [accidentType, setAccidentType] = useState("");
  const [accidentTypeEtc, setAccidentTypeEtc] = useState("");

  const [plannerName, setPlannerName] = useState("");
  const [plannerPhone, setPlannerPhone] = useState("");

  const [careStartDate, setCareStartDate] = useState("");
  const [careEndDate, setCareEndDate] = useState("");
  const [memo, setMemo] = useState("");
  const [privacyAgreed, setPrivacyAgreed] = useState(false);

  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const h = params.get("h");

    if (h) {
      setHospitalCode(h);
      loadHospital(h);
    }
  }, []);

  async function loadHospital(code: string) {
    const { data } = await supabase
      .from("hospitals")
      .select("hospital_id")
      .eq("hospital_code", code)
      .single();

    if (data) {
      setHospitalId(data.hospital_id);
    }
  }

  async function handleSubmit() {
    if (!hospitalId) {
      setMessage("병원 정보를 찾을 수 없습니다.");
      return;
    }

    if (!caregiverName || !caregiverPhone || !patientName || !relationship) {
      setMessage("필수 정보를 입력해주세요.");
      return;
    }

    if (!privacyAgreed) {
      setMessage("개인정보 동의가 필요합니다.");
      return;
    }

    setMessage("등록 중입니다...");

    const familyCode = "FC-" + Date.now();

    const { data: caregiver, error: caregiverError } = await supabase
      .from("caregivers")
      .insert({
        caregiver_name: caregiverName,
        resident_number: residentNumber,
        phone: caregiverPhone.replaceAll("-", ""),
        otp_verified_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (caregiverError || !caregiver) {
      setMessage("간병인 등록 실패: " + caregiverError?.message);
      return;
    }

    const { data: caseData, error: caseError } = await supabase
      .from("cases")
      .insert({
        hospital_id: hospitalId,
        registration_no: null,
        source_type: "hospital_qr",
        family_code: familyCode,
        patient_name: patientName,
        patient_birth_date: patientBirthDate || null,
        patient_phone: patientPhone,
        patient_gender: patientGender,
        diagnosis_name: diagnosisName,
        room_no: roomNo,
        insurance_company: insuranceCompany,
        accident_type: accidentType,
        accident_type_etc: accidentTypeEtc,
        planner_name: plannerName,
        planner_phone: plannerPhone,
        care_start_date: careStartDate || null,
        care_end_date: careEndDate || null,
        memo,
        privacy_agreed: privacyAgreed,
        status: "입원중",
      })
      .select()
      .single();

    if (caseError || !caseData) {
      setMessage("환자 사례 등록 실패: " + caseError?.message);
      return;
    }

    const { error: linkError } = await supabase
      .from("case_caregivers")
      .insert({
        case_id: caseData.case_id,
        caregiver_id: caregiver.caregiver_id,
        relationship,
        is_primary_caregiver: true,
        is_current_caregiver: true,
        status: "활성",
      });

    if (linkError) {
      setMessage("간병인 연결 실패: " + linkError.message);
      return;
    }

    setMessage(`등록 완료. 가족코드: ${familyCode}`);

    setTimeout(() => {
      window.location.href = `/cases/${caseData.case_id}`;
    }, 1500);
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow p-6 space-y-5">
        <h1 className="text-2xl font-bold">간병인 & 환자 등록</h1>
        <p className="text-sm text-gray-500">병원코드: {hospitalCode}</p>

        <section>
          <h2 className="font-bold mb-3">간병인 정보</h2>
          <input className="w-full border p-3 rounded mb-3" placeholder="성명" value={caregiverName} onChange={(e) => setCaregiverName(e.target.value)} />
          <input className="w-full border p-3 rounded mb-3" placeholder="주민등록번호" value={residentNumber} onChange={(e) => setResidentNumber(e.target.value)} />
          <input className="w-full border p-3 rounded" placeholder="연락처" value={caregiverPhone} onChange={(e) => setCaregiverPhone(e.target.value)} />
        </section>

        <section>
          <h2 className="font-bold mb-3">환자 정보</h2>
          <input className="w-full border p-3 rounded mb-3" placeholder="환자명" value={patientName} onChange={(e) => setPatientName(e.target.value)} />
          <input className="w-full border p-3 rounded mb-3" placeholder="생년월일 예: 1950-01-01" value={patientBirthDate} onChange={(e) => setPatientBirthDate(e.target.value)} />
          <input className="w-full border p-3 rounded mb-3" placeholder="환자 연락처" value={patientPhone} onChange={(e) => setPatientPhone(e.target.value)} />

          <select className="w-full border p-3 rounded mb-3" value={patientGender} onChange={(e) => setPatientGender(e.target.value)}>
            <option value="">성별 선택</option>
            <option value="남">남</option>
            <option value="여">여</option>
          </select>

          <select className="w-full border p-3 rounded mb-3" value={relationship} onChange={(e) => setRelationship(e.target.value)}>
            <option value="">환자와의 관계 선택</option>
            <option value="배우자">배우자</option>
            <option value="부모">부모</option>
            <option value="자녀">자녀</option>
            <option value="형제자매">형제자매</option>
            <option value="지인">지인</option>
            <option value="기타">기타</option>
          </select>

          <input className="w-full border p-3 rounded mb-3" placeholder="진단명" value={diagnosisName} onChange={(e) => setDiagnosisName(e.target.value)} />
          <input className="w-full border p-3 rounded" placeholder="입원호실" value={roomNo} onChange={(e) => setRoomNo(e.target.value)} />
        </section>

        <section>
          <h2 className="font-bold mb-3">보험 정보</h2>
          <input className="w-full border p-3 rounded mb-3" placeholder="보험사" value={insuranceCompany} onChange={(e) => setInsuranceCompany(e.target.value)} />
          <input className="w-full border p-3 rounded mb-3" placeholder="사고유형" value={accidentType} onChange={(e) => setAccidentType(e.target.value)} />
          <input className="w-full border p-3 rounded" placeholder="기타 사고유형" value={accidentTypeEtc} onChange={(e) => setAccidentTypeEtc(e.target.value)} />
        </section>

        <section>
          <h2 className="font-bold mb-3">설계사 정보</h2>
          <input className="w-full border p-3 rounded mb-3" placeholder="담당설계사" value={plannerName} onChange={(e) => setPlannerName(e.target.value)} />
          <input className="w-full border p-3 rounded" placeholder="설계사 연락처" value={plannerPhone} onChange={(e) => setPlannerPhone(e.target.value)} />
        </section>

        <section>
          <h2 className="font-bold mb-3">기타</h2>
          <input className="w-full border p-3 rounded mb-3" placeholder="간병개시 예정일 예: 2026-06-01" value={careStartDate} onChange={(e) => setCareStartDate(e.target.value)} />
          <input className="w-full border p-3 rounded mb-3" placeholder="종료일 예: 2026-06-30" value={careEndDate} onChange={(e) => setCareEndDate(e.target.value)} />
          <textarea className="w-full border p-3 rounded mb-3" placeholder="비고" value={memo} onChange={(e) => setMemo(e.target.value)} />

          <label className="flex gap-2 text-sm">
            <input type="checkbox" checked={privacyAgreed} onChange={(e) => setPrivacyAgreed(e.target.checked)} />
            개인정보 수집 및 이용에 동의합니다.
          </label>
        </section>

        <button onClick={handleSubmit} className="w-full bg-blue-600 text-white p-4 rounded-lg font-bold">
          등록하기
        </button>

        {message && <p className="text-center text-sm">{message}</p>}
      </div>
    </main>
  );
}