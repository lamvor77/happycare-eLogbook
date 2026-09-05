/**
 * /log/enter의 `next` 파라미터 해석 — 순수 함수.
 *
 * 열린 리다이렉트를 막는 것이 전부다. `next`는 사용자가 마음대로 바꿀 수
 * 있는 값이므로 문자열 접두사 검사(startsWith)로는 부족하다:
 *   - "//evil.example"     → 프로토콜 상대 URL, 외부로 나간다
 *   - "/my-cases\\@evil"    → 파서에 따라 호스트가 바뀐다
 *   - "%2F%2Fevil"         → 디코딩 뒤 위와 같다
 *   - "/my-cases/../admin" → 정규화 뒤 다른 경로다
 *
 * 그래서 요청 origin을 base로 URL을 구조적으로 파싱하고, 결과의 origin이
 * 우리 origin과 같고 pathname이 허용 목록에 "정확히" 있을 때만 통과시킨다.
 * 그리고 통과한 값을 그대로 쓰지 않는다 — 허용된 pathname으로 목적지를
 * 새로 조립한다. 사용자가 보낸 query/hash는 버린다. 목적지가 병원
 * 토큰을 필요로 하면(최초 등록) 방금 검증한 q를 우리가 붙인다.
 */

const ALLOWED_PATHS = new Set(["/my-cases", "/case-register", "/case-join"]);

/**
 * @param rawNext       요청의 next 파라미터(없으면 null)
 * @param requestOrigin 요청 origin(예: https://ebook.thehappyn.kr)
 * @param validatedQ    방금 get_public_hospital_v2로 확인한 qr_token
 * @returns 절대 URL 문자열. 허용되지 않으면 null.
 */
export function resolveQrEntryNext(
  rawNext: string | null | undefined,
  requestOrigin: string,
  validatedQ: string
): string | null {
  if (typeof rawNext !== "string" || rawNext.length === 0 || rawNext.length > 200) {
    return null;
  }

  // 역슬래시는 WHATWG 파서가 슬래시로 바꾸어 호스트 경계를 흐린다. 정상
  // 목적지에는 있을 수 없는 문자이므로 파싱 전에 거른다.
  if (rawNext.includes("\\")) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawNext, requestOrigin);
  } catch {
    return null;
  }

  if (parsed.origin !== requestOrigin) {
    return null;
  }

  if (!ALLOWED_PATHS.has(parsed.pathname)) {
    return null;
  }

  // 목적지를 새로 조립한다 — 사용자가 보낸 query/hash는 그대로 쓰지 않는다.
  const target = new URL(parsed.pathname, requestOrigin);

  if (parsed.pathname === "/case-register") {
    // 최초 등록 화면은 병원 토큰(q)을 필요로 한다(CaseRegisterClient가
    // searchParams의 q를 읽어 hospital_token으로 보낸다). 사용자가 next에
    // 실어 보낸 q가 아니라, 이 요청에서 방금 검증한 q를 붙인다.
    target.searchParams.set("q", validatedQ);
  }

  return target.toString();
}
