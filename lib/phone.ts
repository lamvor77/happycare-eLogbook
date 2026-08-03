/**
 * 한국 휴대폰번호를 Supabase Phone Auth가 요구하는 E.164 형식으로 정규화한다.
 * 예: "010-1234-5678" / "01012345678" -> "+821012345678"
 */
export function toE164(raw: string): string {
  const trimmed = raw.trim();

  if (trimmed.startsWith("+")) {
    return "+" + trimmed.replace(/[^0-9]/g, "");
  }

  const digits = trimmed.replace(/[^0-9]/g, "");

  if (digits.startsWith("82")) {
    return "+" + digits;
  }

  if (digits.startsWith("0")) {
    return "+82" + digits.slice(1);
  }

  return "+82" + digits;
}
