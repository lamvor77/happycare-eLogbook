import { getKstToday } from "@/lib/kst";

/**
 * 간병일지의 "오늘" 판정 한 곳.
 *
 * 작성 화면(app/case-care-log/[id]/page.tsx)과 작성 API
 * (app/api/cases/[id]/care-logs/route.ts)가 반드시 같은 날짜를 봐야 한다 —
 * 두 곳이 갈리면 "화면에는 오늘 일지가 없다고 나오는데 저장하면 409"
 * 같은 설명하기 어려운 상태가 된다.
 *
 * 기준은 한국시각이다(lib/kst.ts). 서버가 UTC로 도는 탓에 예전에는 한국시각
 * 00:00~09:00 사이에 작성한 일지가 전날 날짜로 저장됐다. care_date는
 * "그 날짜에 간병했다"는 증빙이라 사용자가 보는 날짜와 어긋나면 안 된다.
 */
export function getCareLogToday(): string {
  return getKstToday();
}
