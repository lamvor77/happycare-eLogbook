/**
 * 주민등록번호 원문은 더 이상 수집하지 않는다. 업무상 꼭 필요한 경우에도
 * 앞 7자리(생년월일 6자리 + 성별 구분 1자리)만 입력받아 마스킹된 형태로만
 * 저장한다. 예: "9001011234567" 입력 -> "900101-1******" 로 저장.
 *
 * 반환값이 null이면 입력이 유효하지 않다는 뜻이다(호출부에서 안내 메시지로
 * 처리할 것). 이 값은 caregivers.resident_number_masked 컬럼에만 저장하며,
 * caregivers.resident_number(원문) 컬럼에는 이 모듈을 통해 아무 값도 쓰지
 * 않는다.
 */
export function maskResidentNumberFront7(input: string): string | null {
  const digits = input.replace(/[^0-9]/g, "");

  if (digits.length !== 7) {
    return null;
  }

  return `${digits.slice(0, 6)}-${digits.slice(6, 7)}******`;
}
