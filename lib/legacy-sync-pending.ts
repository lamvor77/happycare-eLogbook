/**
 * "오래 남아있는 pending" 판별 규칙 한 곳.
 *
 * 최초 등록의 기존 시스템 전송은 응답을 보낸 뒤 next/server의 after()
 * 콜백에서 실행된다(app/api/cases/register/route.ts). Vercel에서 after()는
 * waitUntil()에 연결되어 함수 인스턴스의 수명이 콜백이 끝날 때까지
 * 연장되므로 정상적인 경우 전송은 반드시 끝나고 legacy_sync_status는
 * 'synced' 또는 'failed'로 확정된다(lib/legacy-sync.ts의 모든 반환 경로가
 * updateSyncStatus를 호출한다).
 *
 * 다만 플랫폼 장애처럼 예외적인 상황에서 콜백 자체가 유실되면 상태가
 * 'pending'에 머무를 수 있다. 이때 관리자가 수동으로 복구할 수 있어야
 * 하지만, **정상적으로 실행 중인 콜백과 동시에 전송이 두 번 일어나면
 * 안 된다**. 그래서 "pending"이라는 이유만으로 재전송을 허용하지 않고,
 * 정상 처리라면 이미 끝났을 시간이 지난 뒤에만 허용한다
 * (STALE_PENDING_THRESHOLD_MS 참고).
 *
 * 기준 시각으로 cases.created_at을 쓴다 — legacy_sync_status='pending'은
 * register_case_v3의 cases INSERT에서 사례 생성과 같은 트랜잭션에 기록되고
 * (supabase/migrations/20260823090000_legacy_sync_field_map.sql), 이 앱
 * 어디에도 상태를 다시 'pending'으로 되돌리는 경로가 없다(updateSyncStatus는
 * 'synced'/'failed'만 쓴다). 따라서 pending인 사례의 created_at은 곧
 * "pending이 시작된 시각"과 같다. 이 판별을 위해 새로 만든 컬럼은 없다.
 */

/**
 * 이 시간이 지나도록 pending이면 "정상 처리 중"이 아니라 "고착된" 것으로
 * 보고 관리자 재전송을 허용한다.
 *
 * 근거(운영 기준):
 *   - lib/legacy-sync.ts는 Apps Script 요청에 10초(REQUEST_TIMEOUT_MS)
 *     타임아웃을 직접 걸고 있다. 즉 외부 HTTP 왕복은 길어도 10초에서
 *     끊긴다.
 *   - 정상적인 전송은 그 앞뒤의 DB 조회/갱신을 더해도 통상 이보다 약간
 *     긴 범위 안에서 성공이든 실패든 상태가 확정된다.
 *   - 5분은 그 "통상 범위"보다 크게 여유를 둔 보수적인 운영 복구 기준이다.
 *     정상 처리 중인 pending과 고착된 pending을 구분하는 것이 목적이며,
 *     이 시간 안의 pending은 "처리 중일 수 있다"고 보고 재전송을 막는다.
 *
 * 이 값은 특정 플랫폼의 실행시간 제한값과 같아지도록 맞춘 것이 아니다 —
 * 배포 환경의 함수 실행시간 설정이 앞으로 바뀌더라도 위 기준(외부 타임아웃
 * 대비 충분히 보수적인 복구 시점)의 의미는 그대로 유지된다. 전송 자체가
 * 훨씬 느려지는 변경(예: REQUEST_TIMEOUT_MS 대폭 상향)이 생긴다면 그때
 * 이 값을 함께 재검토한다.
 */
export const STALE_PENDING_THRESHOLD_MS = 300_000;

/**
 * 관리자 수동 재전송을 허용해도 되는 상태인지 판단한다.
 *
 * - 'failed'  : 전송이 이미 끝났고 실패로 확정된 상태 → 항상 허용(기존 동작).
 * - 'pending' : created_at이 임계값보다 오래된 경우에만 허용(콜백 유실 복구).
 * - 그 외('synced'/null/알 수 없는 값) → 허용하지 않는다.
 *
 * 순수 함수로 두어 화면(app/admin/cases/page.tsx)과 API
 * (app/api/admin/cases/[id]/legacy-sync/route.ts)가 정확히 같은 조건을
 * 쓰도록 한다 — 화면에서 버튼을 숨기는 것만으로는 API 직접 호출을 막을 수
 * 없기 때문에 두 곳 모두 이 함수로 판단한다.
 */
export function canRetryLegacySync(
  status: string | null,
  createdAt: string | null,
  now: number = Date.now()
): boolean {
  if (status === "failed") {
    return true;
  }

  if (status !== "pending") {
    return false;
  }

  if (!createdAt) {
    // 기준 시각을 알 수 없으면 "처리 중일 수도 있다"는 쪽으로 판단해
    // 중복 전송을 막는다(안전한 기본값).
    return false;
  }

  const startedAt = new Date(createdAt).getTime();

  if (Number.isNaN(startedAt)) {
    return false;
  }

  return now - startedAt >= STALE_PENDING_THRESHOLD_MS;
}
