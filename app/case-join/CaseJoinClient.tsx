"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toE164 } from "@/lib/phone";
import {
  autoFormatResidentNumberInput,
  isValidResidentNumberFormat,
  isConsentComplete,
} from "@/lib/registration-validation";
import {
  RELATIONSHIP_OPTIONS,
  CONSENT_ITEMS,
  CONSENT_VERSION,
  type ConsentKey,
} from "@/lib/registration-options";

/**
 * 가족간병인 추가 참여 화면.
 *
 * 입력 순서는 운영 요구사항 그대로다:
 *   가족코드 → 성명 → 주민등록번호 13자리 → 환자와의 관계 → 휴대폰번호
 *   → 인증번호 받기 → OTP 4자리 → 인증 확인 → 필수 동의 → 참여하기
 *
 * 최초 등록 화면(app/case-register)과 같은 규칙을 재사용한다 — 주민등록번호
 * 13자리 포맷/검증, OTP 입력 정규화, 동의 6개 항목. 새 규칙을 만들지 않는다.
 *
 * 주민등록번호는 서버로 보낸 직후 화면에서 지운다(resetResidentNumber) —
 * 로컬 저장소에 남기지 않는다.
 */
export default function CaseJoinClient() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [familyCode, setFamilyCode] = useState(() => searchParams.get("code") || "");
  const [caregiverName, setCaregiverName] = useState("");
  const [residentNumberInput, setResidentNumberInput] = useState("");
  const [relationship, setRelationship] = useState("");
  const [phone, setPhone] = useState("");

  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  // 인증을 마친 번호. 이후 사용자가 번호를 고치면 인증이 자동으로 무효가
  // 되도록 파생 상태로 비교한다(별도 리셋 로직을 두지 않는다 — 최초 등록
  // 화면과 같은 방식).
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null);

  const [consents, setConsents] = useState<Record<ConsentKey, boolean>>(() =>
    CONSENT_ITEMS.reduce(
      (acc, item) => ({ ...acc, [item.key]: false }),
      {} as Record<ConsentKey, boolean>
    )
  );

  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [navigating, setNavigating] = useState(false);

  function resetResidentNumber() {
    setResidentNumberInput("");
  }

  const residentNumberValid = isValidResidentNumberFormat(residentNumberInput);
  const phoneNormalized = phone.trim() ? toE164(phone) : "";
  // 인증 후 번호가 바뀌면 인증 상태를 잃는다(파생 상태).
  const otpStillValid =
    otpVerified && verifiedPhone !== null && verifiedPhone === phoneNormalized;

  // 성명 + 주민번호 + 관계 + 휴대폰이 모두 유효해야 인증번호를 받을 수 있다.
  const canSendOtp =
    Boolean(familyCode.trim()) &&
    Boolean(caregiverName.trim()) &&
    residentNumberValid &&
    Boolean(relationship) &&
    Boolean(phoneNormalized) &&
    !saving;

  const consentComplete = isConsentComplete(consents);

  // 기존 로그인 세션이 있어도 본인확인을 생략하지 않는다 — 성명/주민등록번호/
  // OTP 인증을 매번 다시 거쳐야 참여할 수 있다(운영 정책). 서버도 같은 조건을
  // 강제한다(app/api/cases/join/route.ts가 세션과 무관하게
  // consumeVerifiedOtp()를 통과해야만 join_case_v3를 호출한다).
  const canSubmit =
    Boolean(familyCode.trim()) &&
    Boolean(relationship) &&
    Boolean(caregiverName.trim()) &&
    residentNumberValid &&
    otpStillValid &&
    consentComplete &&
    !saving &&
    !navigating;

  async function handleSendCode() {
    if (!canSendOtp) {
      setMessage("가족코드, 성명, 주민등록번호, 관계, 휴대폰번호를 먼저 입력해주세요.");
      return;
    }

    setSaving(true);
    setMessage("");

    const response = await fetch("/api/caregiver-auth/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phoneNormalized }),
    });

    setSaving(false);

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setMessage(body?.error || "인증코드 전송에 실패했습니다.");
      return;
    }

    setOtpSent(true);
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
      body: JSON.stringify({ phone: phoneNormalized, code }),
    });

    const body = await response.json().catch(() => null);

    setSaving(false);

    if (!response.ok) {
      setMessage(body?.error || "인증코드가 올바르지 않거나 만료되었습니다.");
      return;
    }

    setOtpVerified(true);
    setVerifiedPhone(phoneNormalized);
    setMessage("휴대폰 인증이 완료되었습니다. 동의 후 참여하기를 눌러주세요.");
  }

  async function handleJoin() {
    if (!canSubmit) {
      setMessage("입력 정보와 동의 항목을 다시 확인해주세요.");
      return;
    }

    setSaving(true);
    setMessage("참여 처리 중입니다...");

    const response = await fetch("/api/cases/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        family_code: familyCode.trim(),
        relationship,
        caregiver_name: caregiverName,
        caregiver_phone: phoneNormalized,
        resident_number: residentNumberInput,
        consent_version: CONSENT_VERSION,
        consents,
      }),
    });

    // 성공/실패와 무관하게, 서버로 보낸 뒤에는 화면에 남겨둘 이유가 없다.
    resetResidentNumber();

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setSaving(false);
      setMessage(body?.error || "참여에 실패했습니다.");
      return;
    }

    // 이동이 끝날 때까지 버튼을 잠가 같은 참여가 두 번 전송되지 않게 한다.
    setSaving(false);
    setNavigating(true);

    setMessage(
      `${body.patient_name} 환자의 가족간병인으로 등록되었습니다. (등록번호 ${body.registration_no})`
    );

    router.push(`/cases/${body.case_id}`);
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 text-gray-900">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow p-6 mt-10 space-y-4">
        <h1 className="text-2xl font-bold">가족간병인 참여</h1>

        <p className="text-sm text-gray-700">
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

        <div>
          <input
            className="w-full border p-3 rounded"
            placeholder="주민등록번호 000000-0000000"
            inputMode="numeric"
            maxLength={14}
            value={residentNumberInput}
            onChange={(e) =>
              setResidentNumberInput(autoFormatResidentNumberInput(e.target.value))
            }
          />

          {residentNumberInput && !residentNumberValid && (
            <p className="mt-1 text-xs text-red-600">
              주민등록번호 13자리를 정확히 입력해주세요.
            </p>
          )}
        </div>

        <select
          className="w-full border p-3 rounded"
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

        <section className="border-t pt-4">
          <h2 className="font-bold mb-3">휴대폰 인증</h2>

          <p className="text-sm text-gray-700 mb-3">
            추가 참여는 로그인 여부와 관계없이 매번 본인확인이 필요합니다.
          </p>

            <input
              className="w-full border p-3 rounded mb-3"
              placeholder="휴대폰번호"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />

            <button
              type="button"
              onClick={handleSendCode}
              disabled={!canSendOtp}
              className="w-full bg-blue-600 text-white p-3 rounded disabled:opacity-50"
            >
              {saving && !otpSent ? "전송 중..." : "인증번호 받기"}
            </button>

            {otpSent && !otpStillValid && (
              <>
                <input
                  className="w-full border p-3 rounded mt-3 mb-3"
                  placeholder="인증코드 4자리"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={4}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                />

                <button
                  type="button"
                  onClick={handleVerifyCode}
                  disabled={saving || code.length !== 4}
                  className="w-full bg-blue-600 text-white p-3 rounded disabled:opacity-50"
                >
                  {saving ? "확인 중..." : "인증 확인"}
                </button>
              </>
            )}

            {otpStillValid && (
              <p className="mt-3 text-sm text-green-700">휴대폰 인증이 완료되었습니다.</p>
            )}
        </section>

        <section className="border-t pt-4">
          <h2 className="font-bold mb-3">확인 및 동의</h2>

          <p className="text-sm text-gray-700 mb-3">
            아래 항목을 모두 확인해야 참여할 수 있습니다.
          </p>

          <div className="space-y-2">
            {CONSENT_ITEMS.map((item) => (
              <label
                key={item.key}
                className="flex items-start gap-2 border rounded p-3 text-sm"
              >
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

        <button
          type="button"
          onClick={handleJoin}
          disabled={!canSubmit}
          className="w-full bg-blue-600 text-white p-4 rounded-lg font-bold min-h-[44px] disabled:opacity-50"
        >
          {navigating ? "이동 중..." : saving ? "처리 중..." : "참여하기"}
        </button>

        {message && <p className="text-center text-sm">{message}</p>}
      </div>
    </main>
  );
}
