"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toE164 } from "@/lib/phone";

type Step = "phone" | "code" | "form";

export default function CaseJoinClient() {
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>("phone");
  const [checkingSession, setCheckingSession] = useState(true);

  const [familyCode, setFamilyCode] = useState(() => searchParams.get("code") || "");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");

  const [caregiverName, setCaregiverName] = useState("");
  const [residentNumberFront7, setResidentNumberFront7] = useState("");
  const [caregiverPhone, setCaregiverPhone] = useState("");
  const [relationship, setRelationship] = useState("");

  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function checkSession() {
      const response = await fetch("/api/caregiver-auth/session");
      const body = await response.json().catch(() => null);

      if (body?.loggedIn) {
        // 이미 유효한 세션이 있으면 휴대폰 인증을 다시 요구하지 않는다
        // (간병종료 시까지 세션을 유지하는 정책).
        setStep("form");
      }

      setCheckingSession(false);
    }

    checkSession();
  }, []);

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

    setCaregiverPhone(phone);
    setStep("form");
    setMessage("휴대폰 인증이 완료되었습니다. 이어서 정보를 입력해주세요.");
  }

  async function handleJoin() {
    if (!familyCode || !caregiverName || !caregiverPhone || !relationship) {
      setMessage("필수 정보를 입력해주세요.");
      return;
    }

    setSaving(true);
    setMessage("가족코드를 확인 중입니다...");

    const response = await fetch("/api/cases/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        family_code: familyCode,
        relationship,
        caregiver_name: caregiverName,
        caregiver_phone: toE164(caregiverPhone),
        resident_number_front7: residentNumberFront7,
      }),
    });

    setSaving(false);

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setMessage(body?.error || "참여에 실패했습니다.");
      return;
    }

    setMessage(
      body.already_joined
        ? `이미 ${body.patient_name} 환자의 가족간병인으로 연결되어 있습니다.`
        : `${body.patient_name} 환자 가족간병인으로 연결되었습니다.`
    );

    setTimeout(() => {
      window.location.href = `/cases/${body.case_id}`;
    }, 1200);
  }

  if (checkingSession) {
    return <main className="p-8 text-gray-900">확인 중입니다...</main>;
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 text-gray-900">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow p-6 mt-10 space-y-4">
        <h1 className="text-2xl font-bold">가족간병인 참여</h1>

        <p className="text-sm text-gray-700">
          가족코드를 입력하고 본인 정보를 등록해주세요.
        </p>

        {step !== "form" && (
          <section>
            <h2 className="font-bold mb-3">휴대폰 인증</h2>
            <p className="text-sm text-gray-700 mb-3">
              참여를 진행하려면 먼저 휴대폰 인증이 필요합니다.
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
              placeholder="주민등록번호 앞 7자리(선택)"
              maxLength={7}
              value={residentNumberFront7}
              onChange={(e) =>
                setResidentNumberFront7(e.target.value.replace(/[^0-9]/g, ""))
              }
            />

            <input
              className="w-full border p-3 rounded"
              placeholder="연락처"
              value={caregiverPhone}
              onChange={(e) => setCaregiverPhone(e.target.value)}
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
              disabled={saving}
              className="w-full bg-blue-600 text-white p-4 rounded-lg font-bold disabled:opacity-50"
            >
              {saving ? "처리 중..." : "참여하기"}
            </button>
          </>
        )}

        {message && <p className="text-center text-sm">{message}</p>}
      </div>
    </main>
  );
}
