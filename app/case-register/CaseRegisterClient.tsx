"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toE164 } from "@/lib/phone";
import {
  RELATIONSHIP_OPTIONS,
  PATIENT_GENDER_OPTIONS,
  ADMISSION_STATUS_OPTIONS,
  CONSENT_ITEMS,
  CONSENT_VERSION,
  type ConsentKey,
} from "@/lib/registration-options";
import {
  autoFormatResidentNumberInput,
  isValidResidentNumberFormat,
  isConsentComplete,
} from "@/lib/registration-validation";

const REGISTRATION_NOTICE = `가족간병은 보호자를 해피간병 소속 간병인으로 등록하는 절차입니다.
반드시 입원 전 또는 입원 당일 등록해야 하며, 등록 이전 기간은 소급하여 처리할 수 없습니다.
가족간병인 등록은 간병인 정보 등록 절차이며, 보험금 지급 여부는 각 보험사의 약관과 심사 기준에 따라 결정됩니다.`;

function buildInitialConsents(): Record<ConsentKey, boolean> {
  const initial = {} as Record<ConsentKey, boolean>;
  for (const item of CONSENT_ITEMS) {
    initial[item.key] = false;
  }
  return initial;
}

export default function CaseRegisterClient() {
  const searchParams = useSearchParams();
  const hospitalCode = searchParams.get("h");
  const hospitalToken = searchParams.get("q");

  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [hospitalName, setHospitalName] = useState("");

  // 2. 간병인 정보
  const [caregiverName, setCaregiverName] = useState("");
  const [residentNumberInput, setResidentNumberInput] = useState("");
  const [relationship, setRelationship] = useState("");

  // 3. 입원 정보
  const [admissionStatus, setAdmissionStatus] = useState("");
  const [roomNo, setRoomNo] = useState("");
  const [careStartDate, setCareStartDate] = useState("");
  const [careEndDate, setCareEndDate] = useState("");
  const [memo, setMemo] = useState("");

  // 4. 환자 정보
  const [patientName, setPatientName] = useState("");
  const [patientBirthYymmdd, setPatientBirthYymmdd] = useState("");
  const [patientBirthCentury, setPatientBirthCentury] = useState<"1900" | "2000">("1900");
  const [patientPhone, setPatientPhone] = useState("");
  const [patientGender, setPatientGender] = useState("");
  const [diagnosisName, setDiagnosisName] = useState("");
  const [accidentType, setAccidentType] = useState("");
  const [accidentTypeEtc, setAccidentTypeEtc] = useState("");

  // 5. 보험/설계사 정보
  const [insuranceCompany, setInsuranceCompany] = useState("");
  const [plannerName, setPlannerName] = useState("");
  const [plannerPhone, setPlannerPhone] = useState("");

  // 6. 확인 및 동의
  const [consents, setConsents] = useState<Record<ConsentKey, boolean>>(
    buildInitialConsents()
  );

  // 7. 인증 및 등록
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [otpStep, setOtpStep] = useState<"phone" | "code" | "verified">("phone");

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
      const response = await fetch("/api/caregiver-auth/session");
      const body = await response.json().catch(() => null);

      if (body?.loggedIn) {
        // 이미 유효한 세션이 있으면 휴대폰 인증을 다시 요구하지 않는다
        // (간병종료 시까지 세션을 유지하는 정책). 이 경우 간병인 정보/
        // 주민등록번호도 다시 입력받지 않는다(서버가 세션의 caregiver를
        // 그대로 사용).
        setHasSession(true);
        setOtpStep("verified");
      }

      setCheckingSession(false);
    }

    loadHospital();
    checkSession();
  }, [hospitalCode, hospitalToken]);

  function resetResidentNumber() {
    setResidentNumberInput("");
  }

  async function handleSendCode() {
    if (!phone.trim()) {
      setMessage("휴대폰번호를 입력해주세요.");
      return;
    }

    setSaving(true);
    setMessage("");

    const response = await fetch("/api/caregiver-auth/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: toE164(phone) }),
    });

    setSaving(false);

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setMessage(body?.error || "인증코드 전송에 실패했습니다.");
      return;
    }

    setOtpStep("code");
    setMessage("입력하신 휴대폰으로 인증코드를 보냈습니다.");
  }

  async function handleVerifyCode() {
    if (!code.trim()) {
      setMessage("인증코드를 입력해주세요.");
      return;
    }

    setSaving(true);
    setMessage("");

    const response = await fetch("/api/caregiver-auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: toE164(phone), code: code.trim() }),
    });

    const body = await response.json().catch(() => null);

    setSaving(false);

    if (!response.ok) {
      setMessage(body?.error || "인증코드가 올바르지 않거나 만료되었습니다.");
      return;
    }

    setOtpStep("verified");
    setMessage("휴대폰 인증이 완료되었습니다. 아래 [등록하기]를 눌러주세요.");
  }

  async function handleSubmit() {
    if (!hospitalToken && !hospitalCode) {
      setMessage("병원 정보를 찾을 수 없습니다.");
      return;
    }

    if (!patientName || !relationship) {
      setMessage("필수 정보를 입력해주세요.");
      return;
    }

    if (!hasSession) {
      if (!caregiverName.trim()) {
        setMessage("간병인 성명을 입력해주세요.");
        return;
      }

      if (!isValidResidentNumberFormat(residentNumberInput)) {
        setMessage("간병인 주민등록번호 13자리를 정확히 입력해주세요.");
        return;
      }

      if (otpStep !== "verified") {
        setMessage("휴대폰 인증을 완료해주세요.");
        return;
      }
    }

    if (patientBirthYymmdd && patientBirthYymmdd.length !== 6) {
      setMessage("환자 생년월일 6자리를 정확히 입력해주세요.");
      return;
    }

    if (!isConsentComplete(consents)) {
      setMessage("동의 항목을 모두 확인해주세요.");
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

        caregiver_name: hasSession ? undefined : caregiverName,
        caregiver_phone: hasSession ? undefined : toE164(phone),
        resident_number: hasSession ? undefined : residentNumberInput,

        admission_status: admissionStatus || undefined,
        room_no: roomNo,
        care_start_date: careStartDate || null,
        care_end_date: careEndDate || null,
        memo,

        patient_name: patientName,
        patient_birth_yymmdd: patientBirthYymmdd || undefined,
        patient_birth_century: patientBirthYymmdd ? patientBirthCentury : undefined,
        patient_phone: patientPhone,
        patient_gender: patientGender,
        relationship,
        diagnosis_name: diagnosisName,
        accident_type: accidentType,
        accident_type_etc: accidentTypeEtc,

        insurance_company: insuranceCompany,
        planner_name: plannerName,
        planner_phone: plannerPhone,

        consent_version: CONSENT_VERSION,
        consents,

        privacy_agreed: consents.privacy_consent_confirmed,
      }),
    });

    // 성공/실패와 무관하게, 서버로 보낸 뒤에는 화면에 남겨둘 이유가 없다.
    resetResidentNumber();

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

  const canSubmit =
    Boolean(patientName) &&
    Boolean(relationship) &&
    isConsentComplete(consents) &&
    (hasSession ||
      (Boolean(caregiverName.trim()) &&
        isValidResidentNumberFormat(residentNumberInput) &&
        otpStep === "verified"));

  if (checkingSession) {
    return <main className="p-8 text-gray-900">확인 중입니다...</main>;
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 text-gray-900">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow p-6 space-y-6">
        {/* 1. 등록 안내 */}
        <section>
          <h1 className="text-2xl font-bold mb-2">간병인 &amp; 환자 등록</h1>
          <p className="text-sm text-gray-700 mb-3">
            병원: {hospitalName || hospitalCode || "-"}
          </p>
          <p className="text-sm text-gray-700 whitespace-pre-line border rounded p-3 bg-gray-50">
            {REGISTRATION_NOTICE}
          </p>
        </section>

        {/* 2. 간병인 정보 */}
        <section>
          <h2 className="font-bold mb-3">간병인 정보</h2>

          {hasSession ? (
            <p className="text-sm text-gray-700">
              기존 세션의 간병인 정보로 등록합니다.
            </p>
          ) : (
            <>
              <label className="block text-sm font-bold text-gray-800 mb-1">
                간병인 성명
              </label>
              <input
                className="w-full border p-3 rounded mb-3 text-gray-900 min-h-[44px]"
                placeholder="성명"
                value={caregiverName}
                onChange={(e) => setCaregiverName(e.target.value)}
              />

              <label className="block text-sm font-bold text-gray-800 mb-1">
                간병인 주민등록번호 (전체 13자리)
              </label>
              <input
                className="w-full border p-3 rounded mb-1 text-gray-900 min-h-[44px]"
                placeholder="000000-0000000"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={14}
                value={residentNumberInput}
                onChange={(e) =>
                  setResidentNumberInput(autoFormatResidentNumberInput(e.target.value))
                }
              />
              <p className="text-xs text-gray-700 mb-3">
                가족간병인 등록 업무를 위해 전체 13자리가 필요합니다. 입력값은
                암호화되어 저장되며, 원문은 이 화면 밖으로 남지 않습니다.
              </p>
            </>
          )}

          <label className="block text-sm font-bold text-gray-800 mb-1">
            환자와의 관계
          </label>
          <select
            className="w-full border p-3 rounded min-h-[44px] text-gray-900"
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
          >
            <option value="">환자와의 관계 선택</option>
            {RELATIONSHIP_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </section>

        {/* 3. 입원 정보 */}
        <section>
          <h2 className="font-bold mb-3">입원 정보</h2>

          <label className="block text-sm font-bold text-gray-800 mb-1">
            현재 상태
          </label>
          <select
            className="w-full border p-3 rounded mb-3 min-h-[44px] text-gray-900"
            value={admissionStatus}
            onChange={(e) => setAdmissionStatus(e.target.value)}
          >
            <option value="">현재 상태 선택</option>
            {ADMISSION_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <label className="block text-sm font-bold text-gray-800 mb-1">
            병원명
          </label>
          <input
            className="w-full border p-3 rounded mb-3 min-h-[44px] bg-gray-100 text-gray-900"
            value={hospitalName || hospitalCode || "-"}
            readOnly
          />

          <label className="block text-sm font-bold text-gray-800 mb-1">
            입원호실
          </label>
          <input
            className="w-full border p-3 rounded mb-3 min-h-[44px] text-gray-900"
            value={roomNo}
            onChange={(e) => setRoomNo(e.target.value)}
          />

          <label className="block text-sm font-bold text-gray-800 mb-1">
            간병개시 예정일
          </label>
          <input
            className="w-full border p-3 rounded mb-3 min-h-[44px] text-gray-900"
            placeholder="예: 2026-06-01"
            value={careStartDate}
            onChange={(e) => setCareStartDate(e.target.value)}
          />

          <label className="block text-sm font-bold text-gray-800 mb-1">
            간병종료 예정일(선택)
          </label>
          <input
            className="w-full border p-3 rounded mb-3 min-h-[44px] text-gray-900"
            placeholder="예: 2026-06-30"
            value={careEndDate}
            onChange={(e) => setCareEndDate(e.target.value)}
          />

          <label className="block text-sm font-bold text-gray-800 mb-1">
            비고
          </label>
          <textarea
            className="w-full border p-3 rounded text-gray-900"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </section>

        {/* 4. 환자 정보 */}
        <section>
          <h2 className="font-bold mb-3">환자 정보</h2>

          <label className="block text-sm font-bold text-gray-800 mb-1">
            환자 성명
          </label>
          <input
            className="w-full border p-3 rounded mb-3 min-h-[44px] text-gray-900"
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
          />

          <label className="block text-sm font-bold text-gray-800 mb-1">
            생년월일 6자리
          </label>
          <div className="flex gap-2 mb-1">
            <input
              className="flex-1 border p-3 rounded min-h-[44px] text-gray-900"
              placeholder="YYMMDD"
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={patientBirthYymmdd}
              onChange={(e) =>
                setPatientBirthYymmdd(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))
              }
            />

            <select
              className="border p-3 rounded min-h-[44px] text-gray-900"
              value={patientBirthCentury}
              onChange={(e) => setPatientBirthCentury(e.target.value as "1900" | "2000")}
            >
              <option value="1900">19XX년생</option>
              <option value="2000">20XX년생</option>
            </select>
          </div>
          <p className="text-xs text-gray-700 mb-3">
            주민등록번호가 아닌 생년월일 6자리만 입력합니다(선택 입력).
          </p>

          <label className="block text-sm font-bold text-gray-800 mb-1">
            성별
          </label>
          <select
            className="w-full border p-3 rounded mb-3 min-h-[44px] text-gray-900"
            value={patientGender}
            onChange={(e) => setPatientGender(e.target.value)}
          >
            <option value="">성별 선택</option>
            {PATIENT_GENDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <label className="block text-sm font-bold text-gray-800 mb-1">
            환자 연락처
          </label>
          <input
            className="w-full border p-3 rounded mb-3 min-h-[44px] text-gray-900"
            value={patientPhone}
            onChange={(e) => setPatientPhone(e.target.value)}
          />

          <label className="block text-sm font-bold text-gray-800 mb-1">
            진단명
          </label>
          <input
            className="w-full border p-3 rounded mb-3 min-h-[44px] text-gray-900"
            value={diagnosisName}
            onChange={(e) => setDiagnosisName(e.target.value)}
          />

          <label className="block text-sm font-bold text-gray-800 mb-1">
            사고유형
          </label>
          <input
            className="w-full border p-3 rounded mb-3 min-h-[44px] text-gray-900"
            value={accidentType}
            onChange={(e) => setAccidentType(e.target.value)}
          />

          <label className="block text-sm font-bold text-gray-800 mb-1">
            기타 사고유형
          </label>
          <input
            className="w-full border p-3 rounded min-h-[44px] text-gray-900"
            value={accidentTypeEtc}
            onChange={(e) => setAccidentTypeEtc(e.target.value)}
          />
        </section>

        {/* 5. 보험/설계사 정보 */}
        <section>
          <h2 className="font-bold mb-3">보험/설계사 정보</h2>

          <label className="block text-sm font-bold text-gray-800 mb-1">
            보험사
          </label>
          <input
            className="w-full border p-3 rounded mb-3 min-h-[44px] text-gray-900"
            value={insuranceCompany}
            onChange={(e) => setInsuranceCompany(e.target.value)}
          />

          <label className="block text-sm font-bold text-gray-800 mb-1">
            담당설계사
          </label>
          <input
            className="w-full border p-3 rounded mb-3 min-h-[44px] text-gray-900"
            value={plannerName}
            onChange={(e) => setPlannerName(e.target.value)}
          />

          <label className="block text-sm font-bold text-gray-800 mb-1">
            설계사 연락처
          </label>
          <input
            className="w-full border p-3 rounded min-h-[44px] text-gray-900"
            value={plannerPhone}
            onChange={(e) => setPlannerPhone(e.target.value)}
          />
        </section>

        {/* 6. 확인 및 동의 */}
        <section>
          <h2 className="font-bold mb-3">확인 및 동의</h2>

          <div className="space-y-2">
            {CONSENT_ITEMS.map((item) => (
              <label key={item.key} className="flex items-start gap-2 text-sm text-gray-900">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={consents[item.key]}
                  onChange={(e) =>
                    setConsents((prev) => ({ ...prev, [item.key]: e.target.checked }))
                  }
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        </section>

        {/* 7. 인증 및 등록 */}
        <section>
          <h2 className="font-bold mb-3">인증 및 등록</h2>

          {!hasSession && otpStep !== "verified" && (
            <div className="mb-3">
              <label className="block text-sm font-bold text-gray-800 mb-1">
                휴대폰 인증
              </label>

              <input
                className="w-full border p-3 rounded mb-3 min-h-[44px] disabled:bg-gray-100 text-gray-900"
                placeholder="휴대폰번호"
                value={phone}
                disabled={otpStep === "code"}
                onChange={(e) => setPhone(e.target.value)}
              />

              {otpStep === "phone" && (
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={saving}
                  className="w-full bg-blue-600 text-white p-3 rounded min-h-[44px] disabled:opacity-50"
                >
                  {saving ? "전송 중..." : "인증코드 받기"}
                </button>
              )}

              {otpStep === "code" && (
                <>
                  <input
                    className="w-full border p-3 rounded mb-3 min-h-[44px] text-gray-900"
                    placeholder="인증코드 6자리"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />

                  <button
                    type="button"
                    onClick={handleVerifyCode}
                    disabled={saving}
                    className="w-full bg-blue-600 text-white p-3 rounded min-h-[44px] disabled:opacity-50"
                  >
                    {saving ? "확인 중..." : "인증 확인"}
                  </button>
                </>
              )}
            </div>
          )}

          {(hasSession || otpStep === "verified") && (
            <p className="text-sm text-green-700 mb-3">
              휴대폰 인증이 완료되었습니다.
            </p>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || !canSubmit}
            className="w-full bg-blue-600 text-white p-4 rounded-lg font-bold min-h-[44px] disabled:opacity-50"
          >
            {saving ? "등록 중..." : "등록하기"}
          </button>
        </section>

        {message && <p className="text-center text-sm">{message}</p>}
      </div>
    </main>
  );
}
