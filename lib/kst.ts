/**
 * 한국시각(KST) 기준 날짜/시각 한 곳.
 *
 * *** 왜 필요한가 ***
 * 이 앱의 서버 코드는 Vercel에서 UTC로 동작한다. 그래서
 *   - `new Date().toISOString().slice(0, 10)` 은 UTC 날짜라, 한국시각
 *     00:00~09:00 사이에는 "어제"를 오늘로 계산한다.
 *   - Server Component에서 `toLocaleString("ko-KR")` 을 호출하면 언어만
 *     한국어일 뿐 시각은 UTC로 렌더링되어, 오후 2시에 쓴 기록이 오전 5시로
 *     보인다(로케일과 시간대는 별개다).
 *
 * 이 서비스의 사용자·병원·보험사가 모두 한국에 있고 간병일지는 "그 날짜에
 * 간병했다"는 증빙이므로, 기준 시간대를 KST로 고정한다. 브라우저 시간대에
 * 맡기지 않는 이유도 같다 — 기기 설정이 달라도 같은 값이 보여야 한다.
 */

export const KST_TIME_ZONE = "Asia/Seoul";

/**
 * KST 기준 "오늘"(YYYY-MM-DD).
 *
 * en-CA 로케일이 YYYY-MM-DD 형식을 주지만, 로케일 데이터에 기대지 않도록
 * 각 구성요소를 직접 조립한다.
 */
export function getKstToday(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * KST 기준 오늘 0시에 해당하는 절대 시각.
 *
 * "오늘 하루 동안 몇 건" 같은 집계의 시작점으로 쓴다. 반환값 자체는 평범한
 * Date(내부적으로는 UTC 순간)이며, 그 순간이 KST 자정과 일치한다.
 */
export function getKstDayStart(date: Date = new Date()): Date {
  // KST는 서머타임이 없어 연중 UTC+9로 고정이다.
  return new Date(`${getKstToday(date)}T00:00:00+09:00`);
}

/**
 * 화면에 보여줄 KST 날짜+시각. `2026-08-30 14:28` 형식이다.
 * 값이 없거나 해석할 수 없으면 "-"를 준다.
 *
 * 로케일 이름("ko-KR")에 기대지 않고 각 구성요소를 직접 조립하는 이유:
 * 같은 코드가 Node 빌드에 따라 "오후 2:28"이 되기도 하고 "PM 2:28"이
 * 되기도 한다(ICU 데이터 차이). 간병일지는 출력물로 나가는 증빙이라
 * 환경에 따라 모양이 달라지면 안 되고, 24시간 표기는 오전/오후를 잘못
 * 읽을 여지도 없다.
 */
export function formatKstDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(parsed);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}
