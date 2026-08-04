import "server-only";
import crypto from "node:crypto";

const SOLAPI_BASE_URL = "https://api.solapi.com";

export class SolapiError extends Error {}

function buildAuthorizationHeader(apiKey: string, apiSecret: string): string {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString("hex");
  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(date + salt)
    .digest("hex");

  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

/**
 * Solapi 발송 API는 국내 번호를 "01012345678" 형태(하이픈/국가코드 없이)로
 * 받는다. lib/phone.ts의 toE164()로 정규화된 "+8210..." 값을 여기서
 * 변환한다.
 */
function toSolapiDomesticNumber(phoneE164: string): string {
  const digits = phoneE164.replace(/[^0-9]/g, "");

  if (digits.startsWith("82")) {
    return "0" + digits.slice(2);
  }

  return digits;
}

/**
 * SMS를 발송한다. 실패 시 SolapiError를 던진다.
 *
 * 주의: message 인자에는 환자명/진단명 등 개인정보를 절대 포함하지 않는다
 * (호출부에서 인증번호 안내 문구만 전달할 것). 이 함수는 전화번호나 응답
 * 상세를 로그에 그대로 남기지 않는다.
 */
export async function sendSms(phoneE164: string, message: string): Promise<void> {
  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;
  const senderNumber = process.env.SOLAPI_SENDER_NUMBER;

  if (!apiKey || !apiSecret || !senderNumber) {
    throw new SolapiError("Solapi 환경변수가 설정되지 않았습니다.");
  }

  const authorization = buildAuthorizationHeader(apiKey, apiSecret);

  let response: Response;

  try {
    response = await fetch(`${SOLAPI_BASE_URL}/messages/v4/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
      },
      body: JSON.stringify({
        message: {
          to: toSolapiDomesticNumber(phoneE164),
          from: senderNumber.replace(/[^0-9]/g, ""),
          text: message,
        },
      }),
    });
  } catch (error) {
    console.error("Solapi 요청 실패(네트워크):", error instanceof Error ? error.message : "unknown");
    throw new SolapiError("SMS 발송에 실패했습니다.");
  }

  if (!response.ok) {
    // 응답 본문에는 전화번호 등이 포함될 수 있으므로 상태 코드만 로그에 남긴다.
    console.error("Solapi 발송 실패, status:", response.status);
    throw new SolapiError("SMS 발송에 실패했습니다.");
  }
}
