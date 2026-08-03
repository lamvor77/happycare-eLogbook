"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { toE164 } from "@/lib/phone";

type Step = "phone" | "code" | "form";

export default function CaseRegisterClient() {
  const searchParams = useSearchParams();
  const hospitalCode = searchParams.get("h");
  const hospitalToken = searchParams.get("q");

  const [step, setStep] = useState<Step>("phone");
  const [checkingSession, setCheckingSession] = useState(true);
  const [hospitalName, setHospitalName] = useState("");

  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");

  const [caregiverName, setCaregiverName] = useState("");
  const [residentNumberFront7, setResidentNumberFront7] = useState("");
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function loadHospital() {
      if (!hospitalCode && !hospitalToken) return;

      const query = hospitalToken
        ? `token=${hospitalToken}`
        : `code=${hospitalCode}`;
      const response = await fetch(`/api/hospitals/lookup?${query}`);
      const body = await response.json().catch(() => null);

      if (response.ok && body?.hospital) {
        setHospitalName(body.hospital.hospital_name);
      }
    }

    async function checkSession() {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        setStep("form");
      }

      setCheckingSession(false);
    }

    loadHospital();
    checkSession();
  }, [hospitalCode, hospitalToken]);

  async function handleSendCode() {
    if (!phone.trim()) {
      setMessage("휴대폰번호를 입력해주세요.");
      return;
    }

    setSaving(true);
    setMessage("");

    const supabase = createSupabaseBrowserClient();

    // 최초 등록은 신규 가입 성격이므로 shouldCreateUser: true를 쓴다
    // (로그인 화면 app/caregiver-login은 기존 계정만 허용하도록 false).
    const { error } = await supabase.auth.signInWithOtp({
      phone: toE164(phone),
      options: { shouldCreateUser: true },
    });

    setSaving(false);

    if (error) {
      setMessage("인증코드 전송에 실패했습니다. 휴대폰번호를 확인해주세요.");
      return;
    }

    setStep("code");
    setMessage("입력하신 휴대폰으로 인증코드를 보냈습니다.");
  }

  async function handleVerifyCode() {
    if (!code.trim()) {
      setMessage("인증코드를 입력해주세요.");
      return;
    }

    setSaving(true);
    setMessage("");

    const supabase = createSupabaseBrowserClient();

    const { error } = await supabase.auth.verifyOtp({
      phone: toE164(phone),
      token: code.trim(),
      type: "sms",
    });

    setSaving(false);

    if (error) {
      setMessage("인증코드가 올바르지 않거나 만료되었습니다.");
      return;
    }

    setCaregiverPhone(phone);
    setStep("form");
    setMessage("휴대폰 인증이 완료되었습니다. 이어서 등록 정보를 입력해주세요.");
  }

  async function handleSubmit() {
    if (!hospitalToken && !hospitalCode) {
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

    setSaving(true);
    setMessage("등록 중입니다...");

    const response = await fetch("/api/cases/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hospital_token: hospitalToken,
        hospital_code: hospitalCode,
        caregiver_name: caregiverName,
        caregiver_phone: toE164(caregiverPhone),
        resident_number_front7: residentNumberFront7,
        patient_name: patientName,
        patient_birth_date: patientBirthDate || null,
        patient_phone: patientPhone,
        patient_gender: patientGender,
        relationship,
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
      }),
    });

    setSaving(false);

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setMessage(body?.error || "등록에 실패했습니다.");
      return;
    }

    setMessage(
      body.is_existing
        ? "이미 등록된 입원중 환자입니다. 기존 사례로 이동합니다."
        : `등록 완료. 가족코드: ${body.family_code}`
    );

    setTimeout(() => {
      window.location.href = `/cases/${body.case_id}`;
    }, 1200);
  }

  if (checkingSession) {
    return <main className="p-8">확인 중입니다...</main>;
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow p-6 space-y-5">
        <h1 className="text-2xl font-bold">간병인 &amp; 환자 등록</h1>
        <p className="text-sm text-gray-500">
          병원: {hospitalName || hospitalCode || "-"}
        </p>

        {step !== "form" && (
          <section>
            <h2 className="font-bold mb-3">휴대폰 인증</h2>
            <p className="text-sm text-gray-500 mb-3">
              등록을 진행하려면 먼저 휴대폰 인증이 필요합니다.
            </p>

            <input
              className="w-full border p-3 rounded mb-3 disabled:bg-gray-100"
              placeholder="휴대폰번호"
              value={phone}
              disabled={step === "code"}
              onChange={(e) => setPhone(e.target.value)}
            />

            {step === "phone" && (
              <button
                onClick={handleSendCode}
                disabled={saving}
                className="w-full bg-blue-600 text-white p-3 rounded disabled:opacity-50"
              >
                {saving ? "전송 중..." : "인증코드 받기"}
              </button>
            )}

            {step === "code" && (
              <>
                <input
                  className="w-full border p-3 rounded mb-3"
                  placeholder="인증코드 6자리"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />

                <button
                  onClick={handleVerifyCode}
                  disabled={saving}
                  className="w-full bg-blue-600 text-white p-3 rounded disabled:opacity-50"
                >
                  {saving ? "확인 중..." : "인증 확인"}
                </button>
              </>
            )}
          </section>
        )}

        {step === "form" && (
          <>
            <section>
              <h2 className="font-bold mb-3">간병인 정보</h2>
              <input className="w-full border p-3 rounded mb-3" placeholder="성명" value={caregiverName} onChange={(e) => setCaregiverName(e.target.value)} />
              <input
                className="w-full border p-3 rounded mb-3"
                placeholder="주민등록번호 앞 7자리(선택)"
                maxLength={7}
                value={residentNumberFront7}
                onChange={(e) => setResidentNumberFront7(e.target.value.replace(/[^0-9]/g, ""))}
              />
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

            <button
              onClick={handleSubmit}
              disabled={saving}
              className="w-full bg-blue-600 text-white p-4 rounded-lg font-bold disabled:opacity-50"
            >
              {saving ? "등록 중..." : "등록하기"}
            </button>
          </>
        )}

        {message && <p className="text-center text-sm">{message}</p>}
      </div>
    </main>
  );
}
