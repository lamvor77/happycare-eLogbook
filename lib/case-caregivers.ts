import type { CaseCaregiver } from "@/types/domain";

/**
 * 사례에 연결된 간병인 목록을 화면에서 어떻게 다룰지에 대한 공통 규칙.
 *
 * 사례 상세(app/cases/[id]/page.tsx)와 간병일지 작성(app/case-care-log/
 * [id]/page.tsx)이 "현재 간병인 변경"을 서로 다른 기준으로 판단하는 일이
 * 없도록 판정을 이 파일 한 곳에 모은다. 순수 함수만 두어 DB/세션에
 * 의존하지 않고 그대로 테스트할 수 있게 한다.
 *
 * 여기서 다루는 것은 "무엇을 보여줄지"뿐이다 — 실제 변경 권한은 서버가
 * 다시 검증한다(app/api/cases/[id]/current-caregiver/route.ts가
 * requireCurrentCaregiverSession + status='활성' 확인 후
 * set_current_caregiver_v2 RPC를 호출한다). 이 파일은 그 검증을 대신하지
 * 않으며, API/RPC는 이번 변경에서 건드리지 않았다.
 */

/** case_caregivers.status에서 "참여 중"을 뜻하는 값. DB 저장값 그대로. */
export const ACTIVE_CAREGIVER_STATUS = "활성";

/**
 * 실제로 이 사례에 참여 중인 간병인만 남긴다.
 *
 * 사례 상세의 case_caregivers 조회에는 status 필터가 없어서 비활성
 * 간병인도 함께 내려온다 — 화면이 그 목록을 그대로 쓰면 이미 빠진
 * 간병인이 변경 후보에 섞인다. 그래서 후보를 만들기 전에 항상 이 함수를
 * 먼저 거친다.
 */
export function getActiveCaregivers(
  caregivers: CaseCaregiver[] | null | undefined
): CaseCaregiver[] {
  return (caregivers || []).filter(
    (item) => item.status === ACTIVE_CAREGIVER_STATUS
  );
}

/**
 * "현재 간병인 변경"에서 고를 수 있는 대상.
 *
 * 활성 상태이면서 지금 현재 간병인이 아닌 사람만 남긴다 — 이미 현재
 * 간병인인 사람을 다시 고르는 것은 의미가 없고(API도 "이미 현재
 * 간병인입니다"로 거절한다), 비활성 간병인은 애초에 변경 대상이 아니다.
 */
export function getCurrentCaregiverChangeCandidates(
  caregivers: CaseCaregiver[] | null | undefined
): CaseCaregiver[] {
  return getActiveCaregivers(caregivers).filter(
    (item) => !item.is_current_caregiver
  );
}

/**
 * "현재 간병인 변경" 영역을 화면에 띄울지 여부.
 *
 * 활성 간병인이 1명뿐이면 바꿀 상대가 없으므로 영역 전체를 보여주지
 * 않는다(제목/안내문구까지 포함해서 — 고를 수 없는 기능을 자리만 차지한
 * 채 보여줄 이유가 없다). 2명 이상이고 변경 권한이 있을 때만 보여준다.
 *
 * canManage는 호출부가 계산해 넘긴다(현재 간병인 본인인지 + 사례가 아직
 * 진행 중인지) — 이 함수는 그 판단을 다시 하지 않는다.
 */
export function canShowCurrentCaregiverChange(
  caregivers: CaseCaregiver[] | null | undefined,
  canManage: boolean
): boolean {
  if (!canManage) {
    return false;
  }

  return getActiveCaregivers(caregivers).length >= 2;
}
