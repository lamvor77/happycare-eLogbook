import "server-only";

/**
 * 쿠키 기반 세션은 SameSite=Lax만으로도 대부분의 CSRF를 막지만, 상태를
 * 바꾸는 API는 Origin 헤더도 함께 확인해 이중으로 방어한다. Origin이
 * 있으면 요청 URL과 같은 origin이어야 하고, Origin이 없으면 Referer로
 * 대체 확인한다. 브라우저가 보내는 정상적인 fetch/폼 제출 요청은 보통
 * Origin 헤더를 포함하므로, 이 헤더가 아예 없는 요청은 의심스러운
 * 요청으로 간주해 차단한다.
 */
export function isSameOriginRequest(request: Request): boolean {
  const requestOrigin = new URL(request.url).origin;

  const origin = request.headers.get("origin");
  if (origin) {
    return origin === requestOrigin;
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === requestOrigin;
    } catch {
      return false;
    }
  }

  return false;
}

export function sameOriginErrorResponse() {
  return Response.json(
    { error: "요청을 처리할 수 없습니다." },
    { status: 403 }
  );
}
