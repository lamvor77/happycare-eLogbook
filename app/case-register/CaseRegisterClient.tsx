"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toE164 } from "@/lib/phone";
import {
  RELATIONSHIP_OPTIONS,
  PATIENT_GENDER_OPTIONS,
  ADMISSION_STATUS_OPTIONS,
  ACCIDENT_TYPE_OPTIONS,
  INSURANCE_COMPANY_OTHER_VALUE,
  CONSENT_ITEMS,
  CONSENT_VERSION,
  type ConsentKey,
} from "@/lib/registration-options";
import {
  autoFormatResidentNumberInput,
  isValidResidentNumberFormat,
  normalizePatientBirthDateYyyymmdd,
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
  const router = useRouter();
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

  // 4. 환자 정보
  const [patientName, setPatientName] = useState("");
  const [patientBirthYyyymmdd, setPatientBirthYyyymmdd] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [patientGender, setPatientGender] = useState("");
  const [diagnosisName, setDiagnosisName] = useState("");
  const [accidentType, setAccidentType] = useState("");

  // 5. 보험/설계사 정보
  const [insuranceCompany, setInsuranceCompany] = useState("");
  const [insuranceCompanyOther, setInsuranceCompanyOther] = useState("");
  const [plannerName, setPlannerName] = useState("");
  const [plannerPhone, setPlannerPhone] = useState("");

  // 보험사/사고유형 선택지 — 기존 가족간병관리 Google Form을 원본으로
  // 서버가 대신 조회한다(GET /api/registration-options). 사고유형은
  // 실패해도 ACCIDENT_TYPE_OPTIONS 고정값으로 대체되므로 항상 값이 있다.
  const [insuranceCompanyOptions, setInsuranceCompanyOptions] = useState<string[]>([]);
  const [accidentTypeOptions, setAccidentTypeOptions] = useState<string[]>(
    ACCIDENT_TYPE_OPTIONS.map((option) => option.value)
  );
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [optionsError, setOptionsError] = useState(false);

  // 6. 확인 및 동의
  const [consents, setConsents] = useState<Record<ConsentKey, boolean>>(
    buildInitialConsents()
  );

  // 7. 인증 및 등록
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [otpStep, setOtpStep] = useState<"phone" | "code" | "verified">("phone");
  // 인증에 성공한 실제 전화번호(E.164) — 인증 후 전화번호가 바뀌면
  // otpVerified가 자동으로 무효화되도록 이 값과 현재 phone을 매번
  // 비교한다(파생 상태라 별도의 "리셋" 로직이 필요 없다).
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null);

  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  // 등록 성공 후 사례 화면으로 이동하는 동안의 상태. 이동은 클라이언트
  // 라우팅이라 즉시 끝나지 않으므로(목적지가 서버 렌더 화면이다), 그
  // 사이에 "등록하기"를 다시 누를 수 있으면 같은 등록이 두 번 전송될 수
  // 있다 — 이동이 끝나 이 컴포넌트가 사라질 때까지 버튼을 잠근다.
  const [navigating, setNavigating] = useState(false);

  // 입력 오류 UX — 필드를 건드리기 전에는 오류를 보여주지 않는다.
  // blur(또는 체크박스 변경) 시점에 해당 필드만 "touched"로 표시한다.
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  function markTouched(field: string) {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  }

  const hasInteracted = Object.keys(touched).length > 0;

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

    async function loadRegistrationOptions() {
      setLoadingOptions(true);

      const response = await fetch("/api/registration-options");
      const body = await response.json().catch(() => null);

      setLoadingOptions(false);

      if (!response.ok || !body) {
        setOptionsError(true);
        return;
      }

      const fetchedInsuranceCompanies = Array.isArray(body.insuranceCompanies)
        ? body.insuranceCompanies
        : [];

      setInsuranceCompanyOptions(fetchedInsuranceCompanies);

      if (Array.isArray(body.accidentTypes) && body.accidentTypes.length > 0) {
        setAccidentTypeOptions(body.accidentTypes);
      }

      // ok:false여도(예: 마지막 성공 캐시를 재사용) 목록 자체는 쓸 수
      // 있으므로 목록이 비어 있을 때만 오류 문구를 보여준다(작업 18).
      setOptionsError(!body.ok && fetchedInsuranceCompanies.length === 0);
    }

    loadHospital();
    checkSession();
    loadRegistrationOptions();
  }, [hospitalCode, hospitalToken]);

  function resetResidentNumber() {
    setResidentNumberInput("");
  }

  async function handleSendCode() {
    if (!caregiverAuthReady) {
      setMessage("간병인 성명·주민등록번호·휴대폰번호를 정확히 입력해주세요.");
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

    // 이전에 인증했던 번호를 바꿔 재인증하는 경우(needsReauth)에도 새
    // 코드 입력을 깨끗한 상태에서 시작하도록 이전 코드/인증 상태를
    // 함께 정리한다.
    setCode("");
    setVerifiedPhone(null);
    setOtpStep("code");
    setMessage("입력하신 휴대폰으로 인증코드를 보냈습니다.");
  }

  async function handleVerifyCode() {
    if (code.length !== 4) {
      setMessage("인증코드 4자리를 입력해주세요.");
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

    setVerifiedPhone(toE164(phone));
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

      if (!otpVerified) {
        setMessage("휴대폰 인증을 완료해주세요.");
        return;
      }
    }

    if (!normalizePatientBirthDateYyyymmdd(patientBirthYyyymmdd)) {
      setMessage("환자 생년월일 8자리(YYYYMMDD)를 정확히 입력해주세요.");
      return;
    }

    if (!hasValidInsuranceCompany) {
      setMessage("보험사를 선택하거나 직접 입력해주세요.");
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
        // "간병종료 예정일" 입력 UI를 최초 등록 화면에서 제거했다(운영
        // 요청) — 서버 API 계약(care_end_date 필드)/DB 컬럼
        // (cases.care_end_date)/register_case_v3의 p_care_end_date는
        // 그대로 유지하므로 null을 보낸다. 관리자/간병종료 기능이 이
        // 컬럼을 쓰는 방식은 건드리지 않았다.
        care_end_date: null,
        // "비고" 입력 UI를 최초 등록 화면에서 제거했다(운영 요청) — 서버
        // API 계약(memo 필드)/DB 컬럼(cases.memo)/legacy Sheet "비고"
        // 컬럼은 그대로 유지하므로 빈 문자열을 보낸다. 기존에 이미 저장된
        // memo 값이나 관리자 화면의 조회 기능에는 영향이 없다.
        memo: "",

        patient_name: patientName,
        patient_birth_yyyymmdd: patientBirthYyyymmdd,
        patient_phone: patientPhone,
        patient_gender: patientGender,
        relationship,
        diagnosis_name: diagnosisName,
        accident_type: accidentType,
        // "기타 사고유형" 입력 UI를 최초 등록 화면에서 제거했다(운영
        // 요청) — 사고유형 선택지 자체는 고정 3개 값(질병/상해/교통사고)
        // 뿐이라 "기타"를 고를 수 없고, 이 값은 애초에 서버 검증에서도
        // 선택值이라 없어도 등록에 영향이 없다(app/api/cases/register/
        // route.ts는 없으면 null로 저장). accident_type_etc DB 컬럼/API
        // 계약은 그대로 유지하므로 null을 보낸다.
        accident_type_etc: null,

        insurance_company: insuranceCompany.trim(),
        insurance_company_other:
          insuranceCompany === INSURANCE_COMPANY_OTHER_VALUE
            ? insuranceCompanyOther.trim()
            : undefined,
        planner_name: plannerName,
        planner_phone: plannerPhone,

        consent_version: CONSENT_VERSION,
        consents,

        privacy_agreed: consents.privacy_consent_confirmed,
      }),
    });

    // 성공/실패와 무관하게, 서버로 보낸 뒤에는 화면에 남겨둘 이유가 없다.
    resetResidentNumber();

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setSaving(false);
      setMessage(body?.error || "등록에 실패했습니다.");
      return;
    }

    // 성공 시에는 saving을 내리지 않고 navigating으로 이어받는다 — 이동이
    // 끝날 때까지 버튼이 계속 잠겨 있어야 중복 등록을 막을 수 있다.
    setSaving(false);
    setNavigating(true);

    setMessage(
      body.is_existing
        ? "이미 등록된 입원중 환자입니다. 기존 사례로 이동합니다."
        : `등록 완료. 가족코드: ${body.family_code}`
    );

    // 예전에는 가족코드를 읽을 시간을 주려고 1.2초를 기다린 뒤
    // window.location.href로 전체 페이지를 다시 불러왔다. 이동한 사례
    // 화면(app/cases/[id]/page.tsx)이 이미 "가족코드: ..."를 계속 보여주고
    // 있어 그 대기가 필요 없고, 전체 리로드는 번들을 다시 내려받게 만든다.
    // 그래서 고정 대기 없이 클라이언트 라우팅으로 바로 이동한다.
    //
    // 새 간병인의 세션 쿠키는 이 fetch 응답의 Set-Cookie로 이미 브라우저에
    // 저장된 상태라(응답 헤더는 body를 읽기 전에 처리된다), 같은 출처로
    // 나가는 이 이동 요청에 그대로 실려 간다 — 목적지의
    // requireCaseMemberSession도 정상 인식한다. 전체 리로드가 쿠키 반영을
    // 위해 필요했던 것이 아니므로 router.refresh()도 넣지 않는다.
    router.push(`/cases/${body.case_id}`);
  }

  // "등록하기" 버튼 활성화 조건 — 판정 기준을 이름 붙은 변수로 나눠
  // handleSubmit의 개별 검증(위)과 정확히 같은 기준을 쓰도록 한다(QA
  // 진단용으로도 각 조건을 분리해 어떤 조건이 막고 있는지 추적하기 쉽게
  // 한다 — 화면에 노출하거나 개인정보를 로그로 남기지는 않는다).
  const requiredFieldsValid =
    Boolean(patientName) &&
    Boolean(relationship) &&
    Boolean(normalizePatientBirthDateYyyymmdd(patientBirthYyyymmdd));

  // 인증된 전화번호와 현재 입력된 전화번호가 다르면(예: 인증 후 번호를
  // 바꾼 경우) 인증 상태를 무효로 취급한다 — verifiedPhone과 매번 비교하는
  // 파생값이라 별도의 리셋 로직 없이도 항상 최신 상태를 반영한다. 이름/
  // 환자정보 등 phone과 무관한 값이 바뀌어도 이 조건에는 영향이 없다.
  const otpVerified =
    hasSession ||
    (otpStep === "verified" && phone.trim() !== "" && verifiedPhone === toE164(phone));

  // 인증을 마친 뒤 전화번호를 다시 바꿔 재인증이 필요한 상태 — otpStep
  // 자체는 아직 "verified"로 남아있지만(setState를 렌더 중/effect에서
  // 하지 않기 위해 그대로 둠) verifiedPhone과 현재 phone이 달라 무효가
  // 된 경우다. 이 값에 따라 "인증번호 받기"/코드 입력 UI를 파생값으로만
  // 다시 보여준다.
  const needsReauth =
    !hasSession &&
    otpStep === "verified" &&
    verifiedPhone !== null &&
    verifiedPhone !== toE164(phone);

  const showOtpSendButton = !hasSession && !otpVerified && (otpStep === "phone" || needsReauth);
  const showOtpCodeStep = !hasSession && !otpVerified && otpStep === "code" && !needsReauth;

  const caregiverFieldsValid =
    hasSession ||
    (Boolean(caregiverName.trim()) && isValidResidentNumberFormat(residentNumberInput));

  const allConsentsChecked = isConsentComplete(consents);

  // 보험사는 정상 select 모드에서는 select 값(또는 "기타" 상세), config
  // 조회가 실패해 직접입력 fallback으로 전환된 상태에서는 그 입력값을
  // 그대로 쓴다 — 두 모드 모두 insuranceCompany state 하나를 공유하므로
  // fallback 모드에서 직접 입력해도 이 조건이 정상적으로 충족된다(어떤
  // 목록이 로드됐는지와 무관하게 "실제 입력된 값이 있는가"만 본다).
  const effectiveInsuranceCompany =
    insuranceCompany === INSURANCE_COMPANY_OTHER_VALUE
      ? insuranceCompanyOther.trim()
      : insuranceCompany.trim();

  const hasValidInsuranceCompany = effectiveInsuranceCompany.length > 0;

  // 간병인 인증(휴대폰 OTP) 발송 조건 — 등록정보 전체가 아니라 "간병인
  // 본인 인증에 필요한 정보"만 본다(작업: 간병인 정보 섹션 내 인증).
  // 환자/보험/동의 등 나머지 등록정보는 이 조건과 무관하다.
  const caregiverNameValid = Boolean(caregiverName.trim());
  const residentNumberValid = isValidResidentNumberFormat(residentNumberInput);
  const phoneValid = Boolean(phone.trim());
  const caregiverAuthReady =
    caregiverNameValid && residentNumberValid && phoneValid && !saving;

  // "등록하기" 버튼 활성화 조건 — 기존 전체 필수조건을 그대로 확인한다
  // (OTP 발송 가능 여부와는 별개 — 인증 후에도 환자/보험/동의 등 나머지
  // 정보를 자유롭게 입력/수정할 수 있어야 하므로 단계로 나누지 않는다).
  const canSubmit =
    requiredFieldsValid &&
    otpVerified &&
    caregiverFieldsValid &&
    allConsentsChecked &&
    hasValidInsuranceCompany;

  // 필드별 오류 메시지 — handleSubmit의 개별 검증/canSubmit의 각 조건과
  // 1:1 대응하는 한국어 문구만 만든다. 주민번호/전화번호 실제 입력값은
  // 어떤 메시지에도 포함하지 않는다(고정 문구만 사용).
  const patientNameError = !patientName ? "환자 성명을 입력해주세요." : "";
  const relationshipError = !relationship ? "환자와의 관계를 선택해주세요." : "";
  const patientBirthError = !normalizePatientBirthDateYyyymmdd(patientBirthYyyymmdd)
    ? "생년월일 8자리(YYYYMMDD)를 정확히 입력해주세요. 실제 존재하는 날짜인지 확인해주세요."
    : "";
  const caregiverNameError =
    !hasSession && !caregiverNameValid ? "간병인 성명을 입력해주세요." : "";
  const residentNumberError =
    !hasSession && !residentNumberValid
      ? "간병인 주민등록번호 13자리를 정확히 입력해주세요."
      : "";
  // 전화번호 자체가 비어있는 경우와, 번호는 있지만 아직 인증을 마치지
  // 않은 경우를 구분해 중복 안내가 뜨지 않게 한다.
  const phoneError = !hasSession && !phoneValid ? "간병인 휴대폰번호를 입력해주세요." : "";
  const otpError =
    !hasSession && !otpVerified && phoneValid ? "휴대폰 인증을 완료해주세요." : "";
  const insuranceCompanyError = !hasValidInsuranceCompany
    ? "보험사를 선택하거나 직접 입력해주세요."
    : "";
  const consentsError = !allConsentsChecked ? "동의 항목을 모두 확인해주세요." : "";

  const errorSummary = [
    caregiverNameError,
    residentNumberError,
    phoneError,
    otpError,
    patientNameError,
    relationshipError,
    patientBirthError,
    insuranceCompanyError,
    consentsError,
  ].filter(Boolean);

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
                className={`w-full border p-3 rounded text-gray-900 min-h-[44px] ${
                  touched.caregiverName && caregiverNameError
                    ? "border-red-500"
                    : ""
                } ${touched.caregiverName && caregiverNameError ? "mb-1" : "mb-3"}`}
                placeholder="성명"
                value={caregiverName}
                onChange={(e) => setCaregiverName(e.target.value)}
                onBlur={() => markTouched("caregiverName")}
                aria-invalid={Boolean(touched.caregiverName && caregiverNameError)}
                aria-describedby={
                  touched.caregiverName && caregiverNameError
                    ? "caregiverName-error"
                    : undefined
                }
              />
              {touched.caregiverName && caregiverNameError && (
                <p id="caregiverName-error" className="text-xs text-red-600 mb-3">
                  {caregiverNameError}
                </p>
              )}

              <label className="block text-sm font-bold text-gray-800 mb-1">
                간병인 주민등록번호 (전체 13자리)
              </label>
              <input
                className={`w-full border p-3 rounded mb-1 text-gray-900 min-h-[44px] ${
                  touched.residentNumber && residentNumberError ? "border-red-500" : ""
                }`}
                placeholder="000000-0000000"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={14}
                value={residentNumberInput}
                onChange={(e) =>
                  setResidentNumberInput(autoFormatResidentNumberInput(e.target.value))
                }
                onBlur={() => markTouched("residentNumber")}
                aria-invalid={Boolean(touched.residentNumber && residentNumberError)}
                aria-describedby={
                  touched.residentNumber && residentNumberError
                    ? "residentNumber-error"
                    : "residentNumber-help"
                }
              />
              {touched.residentNumber && residentNumberError && (
                <p id="residentNumber-error" className="text-xs text-red-600 mb-1">
                  {residentNumberError}
                </p>
              )}
              <p id="residentNumber-help" className="text-xs text-gray-700 mb-3">
                가족간병인 등록 업무를 위해 전체 13자리가 필요합니다. 입력값은
                암호화되어 저장되며, 원문은 이 화면 밖으로 남지 않습니다.
              </p>

              <label className="block text-sm font-bold text-gray-800 mb-1">
                간병인 휴대폰 번호
              </label>
              <input
                className={`w-full border p-3 rounded mb-1 min-h-[44px] disabled:bg-gray-100 text-gray-900 ${
                  touched.otp && (phoneError || otpError) ? "border-red-500" : ""
                }`}
                placeholder="휴대폰번호"
                value={phone}
                disabled={otpStep === "code"}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={() => markTouched("otp")}
                aria-invalid={Boolean(touched.otp && (phoneError || otpError))}
                aria-describedby={
                  touched.otp && (phoneError || otpError) ? "phone-otp-error" : undefined
                }
              />
              {touched.otp && (phoneError || otpError) ? (
                <p id="phone-otp-error" className="text-xs text-red-600 mb-3">
                  {phoneError || otpError}
                </p>
              ) : (
                <div className="mb-2" />
              )}

              {!otpVerified && !caregiverAuthReady && (
                <p className="text-xs text-gray-600 mb-2">
                  간병인 성명·주민등록번호·휴대폰번호를 정확히 입력하면
                  인증번호를 받을 수 있습니다.
                </p>
              )}

              {showOtpSendButton && (
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={!caregiverAuthReady}
                  className="w-full bg-blue-600 text-white p-3 rounded min-h-[44px] disabled:opacity-50"
                >
                  {saving ? "전송 중..." : "인증번호 받기"}
                </button>
              )}

              {showOtpCodeStep && (
                <>
                  {/*
                    onPaste 커스텀 핸들러를 일부러 두지 않는다(2026-08-26
                    실기기 확인) — 붙여넣은 텍스트에서 숫자만 추출하려고
                    e.preventDefault()를 호출하던 이전 구현이 일부 모바일
                    브라우저(Android WebView/Samsung Internet 계열)의
                    "붙여넣기" 컨텍스트 메뉴 동작 자체를 막아버렸다. 브라우저
                    기본 붙여넣기를 그대로 두고, 결과 문자열은 아래 onChange가
                    숫자만 남기고 4자리로 잘라내는 것으로 충분하다(정확히
                    4자리만 복사하는 일반적인 경우를 최우선한다).
                  */}
                  <input
                    className="w-full border p-3 rounded mb-3 min-h-[44px] text-gray-900 tracking-widest text-center text-lg"
                    placeholder="인증코드 4자리"
                    value={code}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={4}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  />

                  <button
                    type="button"
                    onClick={handleVerifyCode}
                    disabled={saving || code.length !== 4}
                    className="w-full bg-blue-600 text-white p-3 rounded min-h-[44px] disabled:opacity-50"
                  >
                    {saving ? "확인 중..." : "인증 확인"}
                  </button>
                </>
              )}

              {otpVerified && (
                <p className="text-sm text-green-700 mb-3">
                  휴대폰 인증이 완료되었습니다.
                </p>
              )}
            </>
          )}

          <label className="block text-sm font-bold text-gray-800 mb-1">
            환자와의 관계
          </label>
          <select
            className={`w-full border p-3 rounded min-h-[44px] text-gray-900 ${
              touched.relationship && relationshipError ? "border-red-500" : ""
            }`}
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            onBlur={() => markTouched("relationship")}
            aria-invalid={Boolean(touched.relationship && relationshipError)}
            aria-describedby={
              touched.relationship && relationshipError ? "relationship-error" : undefined
            }
          >
            <option value="">환자와의 관계 선택</option>
            {RELATIONSHIP_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {touched.relationship && relationshipError && (
            <p id="relationship-error" className="text-xs text-red-600 mt-1">
              {relationshipError}
            </p>
          )}
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
            className="w-full border p-3 rounded mb-1 min-h-[44px] text-gray-900"
            value={roomNo}
            onChange={(e) => setRoomNo(e.target.value)}
            aria-describedby="roomNo-help"
          />
          <p id="roomNo-help" className="text-xs text-gray-700 mb-3">
            📢 호실 미정 시 입력하지 않아도 됩니다.
          </p>

          <label className="block text-sm font-bold text-gray-800 mb-1">
            간병개시 예정일
          </label>
          <input
            className="w-full border p-3 rounded mb-1 min-h-[44px] text-gray-900"
            type="date"
            value={careStartDate}
            onChange={(e) => setCareStartDate(e.target.value)}
            aria-describedby="careStartDate-help"
          />
          <p id="careStartDate-help" className="text-xs text-gray-700">
            📢 입원 일정에 따라 실제 간병개시일은 변경될 수 있습니다.
          </p>
        </section>

        {/* 4. 환자 정보 */}
        <section>
          <h2 className="font-bold mb-3">환자 정보</h2>

          <label className="block text-sm font-bold text-gray-800 mb-1">
            환자 성명
          </label>
          <input
            className={`w-full border p-3 rounded mb-1 min-h-[44px] text-gray-900 ${
              touched.patientName && patientNameError ? "border-red-500" : ""
            }`}
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            onBlur={() => markTouched("patientName")}
            aria-invalid={Boolean(touched.patientName && patientNameError)}
            aria-describedby={
              touched.patientName && patientNameError ? "patientName-error" : undefined
            }
          />
          {touched.patientName && patientNameError ? (
            <p id="patientName-error" className="text-xs text-red-600 mb-3">
              {patientNameError}
            </p>
          ) : (
            <div className="mb-3" />
          )}

          <label className="block text-sm font-bold text-gray-800 mb-1">
            생년월일 8자리
          </label>
          <input
            className={`w-full border p-3 rounded mb-1 min-h-[44px] text-gray-900 ${
              touched.patientBirth && patientBirthError ? "border-red-500" : ""
            }`}
            placeholder="YYYYMMDD"
            type="text"
            inputMode="numeric"
            maxLength={8}
            value={patientBirthYyyymmdd}
            onChange={(e) =>
              setPatientBirthYyyymmdd(e.target.value.replace(/[^0-9]/g, "").slice(0, 8))
            }
            onBlur={() => markTouched("patientBirth")}
            aria-invalid={Boolean(touched.patientBirth && patientBirthError)}
            aria-describedby={
              touched.patientBirth && patientBirthError
                ? "patientBirth-error"
                : "patientBirth-help"
            }
          />
          {touched.patientBirth && patientBirthError && (
            <p id="patientBirth-error" className="text-xs text-red-600 mb-1">
              {patientBirthError}
            </p>
          )}
          <p id="patientBirth-help" className="text-xs text-gray-700 mb-3">
            주민등록번호가 아닌 생년월일 8자리(예: 19500101)를 입력합니다.
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
          <select
            className="w-full border p-3 rounded min-h-[44px] text-gray-900"
            value={accidentType}
            onChange={(e) => setAccidentType(e.target.value)}
          >
            <option value="">사고유형 선택</option>
            {accidentTypeOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </section>

        {/* 5. 보험/설계사 정보 */}
        <section>
          <h2 className="font-bold mb-3">보험/설계사 정보</h2>

          <label className="block text-sm font-bold text-gray-800 mb-1">
            보험사
          </label>
          {loadingOptions ? (
            <p className="text-sm text-gray-700 mb-3">보험사 정보를 불러오는 중입니다...</p>
          ) : optionsError && insuranceCompanyOptions.length === 0 ? (
            <>
              <p className="text-sm text-red-600 mb-1">
                보험사 목록을 불러오지 못했습니다. 보험사명을 직접 입력해주세요.
              </p>
              <input
                className={`w-full border p-3 rounded mb-1 min-h-[44px] text-gray-900 ${
                  touched.insuranceCompany && insuranceCompanyError ? "border-red-500" : ""
                }`}
                value={insuranceCompany}
                onChange={(e) => setInsuranceCompany(e.target.value)}
                onBlur={() => markTouched("insuranceCompany")}
                aria-invalid={Boolean(touched.insuranceCompany && insuranceCompanyError)}
                aria-describedby={
                  touched.insuranceCompany && insuranceCompanyError
                    ? "insuranceCompany-error"
                    : undefined
                }
              />
              {touched.insuranceCompany && insuranceCompanyError ? (
                <p id="insuranceCompany-error" className="text-xs text-red-600 mb-3">
                  {insuranceCompanyError}
                </p>
              ) : (
                <div className="mb-2" />
              )}
            </>
          ) : (
            <>
              <select
                className={`w-full border p-3 rounded mb-1 min-h-[44px] text-gray-900 ${
                  touched.insuranceCompany && insuranceCompanyError ? "border-red-500" : ""
                }`}
                value={insuranceCompany}
                onChange={(e) => {
                  setInsuranceCompany(e.target.value);
                  if (e.target.value !== INSURANCE_COMPANY_OTHER_VALUE) {
                    setInsuranceCompanyOther("");
                  }
                }}
                onBlur={() => markTouched("insuranceCompany")}
                aria-invalid={Boolean(touched.insuranceCompany && insuranceCompanyError)}
                aria-describedby={
                  touched.insuranceCompany && insuranceCompanyError
                    ? "insuranceCompany-error"
                    : undefined
                }
              >
                <option value="">보험사 선택</option>
                {insuranceCompanyOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
                {!insuranceCompanyOptions.includes(INSURANCE_COMPANY_OTHER_VALUE) && (
                  <option value={INSURANCE_COMPANY_OTHER_VALUE}>{INSURANCE_COMPANY_OTHER_VALUE}</option>
                )}
              </select>
              {touched.insuranceCompany && insuranceCompanyError && (
                <p id="insuranceCompany-error" className="text-xs text-red-600 mb-3">
                  {insuranceCompanyError}
                </p>
              )}
            </>
          )}

          {insuranceCompany === INSURANCE_COMPANY_OTHER_VALUE && (
            <>
              <label className="block text-sm font-bold text-gray-800 mb-1">
                기타인 경우 입력해주세요
              </label>
              <input
                className={`w-full border p-3 rounded mb-3 min-h-[44px] text-gray-900 ${
                  touched.insuranceCompany && insuranceCompanyError ? "border-red-500" : ""
                }`}
                value={insuranceCompanyOther}
                onChange={(e) => setInsuranceCompanyOther(e.target.value)}
                onBlur={() => markTouched("insuranceCompany")}
              />
            </>
          )}

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
            className="w-full border p-3 rounded mb-1 min-h-[44px] text-gray-900"
            value={plannerPhone}
            onChange={(e) => setPlannerPhone(e.target.value)}
            aria-describedby="plannerPhone-help"
          />
          {/* 설계사 알림톡은 기존 가족간병관리 시스템(Apps Script)이
              접수·등록완료 시점에 보낸다. 연락처가 없으면 대상이 없어
              발송되지 않으므로 "입력하면 안내된다"까지만 말한다. */}
          <p id="plannerPhone-help" className="text-xs text-gray-700">
            📢 연락처를 입력하시면 등록 내용이 알림톡으로 안내됩니다.
          </p>
        </section>

        {/* 6. 확인 및 동의 */}
        <section>
          <h2 className="font-bold mb-3">확인 및 동의</h2>

          <label
            className={`flex items-start gap-2 text-sm font-bold text-gray-900 mb-2 pb-2 border-b ${
              touched.consents && consentsError ? "text-red-600" : ""
            }`}
          >
            <input
              type="checkbox"
              className="mt-1"
              checked={allConsentsChecked}
              onChange={(e) => {
                const checked = e.target.checked;
                markTouched("consents");
                setConsents(() => {
                  const next = {} as Record<ConsentKey, boolean>;
                  for (const item of CONSENT_ITEMS) {
                    next[item.key] = checked;
                  }
                  return next;
                });
              }}
              aria-invalid={Boolean(touched.consents && consentsError)}
              aria-describedby={
                touched.consents && consentsError ? "consents-error" : undefined
              }
            />
            <span>전체 동의</span>
          </label>

          <div className="space-y-2">
            {CONSENT_ITEMS.map((item) => (
              <label key={item.key} className="flex items-start gap-2 text-sm text-gray-900">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={consents[item.key]}
                  onChange={(e) => {
                    markTouched("consents");
                    setConsents((prev) => ({ ...prev, [item.key]: e.target.checked }));
                  }}
                  aria-invalid={Boolean(touched.consents && consentsError)}
                  aria-describedby={
                    touched.consents && consentsError ? "consents-error" : undefined
                  }
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
          {touched.consents && consentsError && (
            <p id="consents-error" className="text-xs text-red-600 mt-2">
              {consentsError}
            </p>
          )}
        </section>

        {/* 7. 등록 */}
        <section>
          <h2 className="font-bold mb-3">등록</h2>

          {hasInteracted && !canSubmit && errorSummary.length > 0 && (
            <div
              className="mb-3 border border-red-300 bg-red-50 rounded p-3"
              role="alert"
            >
              <p className="text-sm font-bold text-red-700 mb-1">
                등록 전 확인이 필요합니다
              </p>
              <ul className="text-xs text-red-700 list-disc list-inside space-y-0.5">
                {errorSummary.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || navigating || !canSubmit}
            className="w-full bg-blue-600 text-white p-4 rounded-lg font-bold min-h-[44px] disabled:opacity-50"
          >
            {navigating ? "이동 중..." : saving ? "등록 중..." : "등록하기"}
          </button>
        </section>

        {message && <p className="text-center text-sm">{message}</p>}
      </div>
    </main>
  );
}
