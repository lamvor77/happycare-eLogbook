import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 테스트/QA 전용 데이터 초기화(/admin/test-reset)의 서버 공용 로직.
 * Preview와 Execute가 같은 계산을 쓰도록 여기에 모아둔다 — Execute는
 * 클라이언트가 보낸 건수/대상 목록을 신뢰하지 않고 항상 이 함수들로 서버에서
 * 다시 조회한다.
 *
 * 개인정보 원칙: 주민등록번호(원문/암호문/IV/태그)는 어떤 조회에도 포함하지
 * 않는다. 환자명/간병인명은 마스킹해서만 반환하고, 감사 로그에는 건수만
 * 남긴다.
 */

export const CARE_LOG_PHOTO_BUCKET = "care-log-photos";

/** Preview 발급 후 이 시간이 지나면 Execute를 거부한다. */
export const PREVIEW_MAX_AGE_MS = 10 * 60 * 1000;

export const RESET_CONFIRMATION_TEXT = "RESET";

export type TestResetMode = "phone" | "case" | "hospital";

export interface TestResetCounts {
  caregivers: number;
  cases: number;
  case_caregivers: number;
  care_logs: number;
  care_log_photos: number;
  consents: number;
  /** 이 사례들에 달린 간병인 등록 건(initial/family_join). */
  caregiver_registrations: number;
  histories: number;
  sessions: number;
  otp_codes: number;
}

export interface TestResetCaseSummary {
  case_id: string;
  case_no: string | null;
  patient_name_masked: string;
  status: string;
  care_log_count: number;
  linked_caregiver_count: number;
  /** 이 사례에 연결된 간병인이 초기화 대상 1명뿐이라 사례까지 삭제되는지 */
  case_will_be_deleted: boolean;
}

export interface TestResetPreview {
  mode: TestResetMode;
  found: boolean;
  target_id: string | null;
  target_label: string;
  counts: TestResetCounts;
  cases: TestResetCaseSummary[];
}

function emptyCounts(): TestResetCounts {
  return {
    caregivers: 0,
    cases: 0,
    case_caregivers: 0,
    care_logs: 0,
    care_log_photos: 0,
    consents: 0,
    caregiver_registrations: 0,
    histories: 0,
    sessions: 0,
    otp_codes: 0,
  };
}

/** 이름 마스킹: 홍길동 -> 홍*동, 김철 -> 김*, 한 -> * */
export function maskPersonName(name: string | null | undefined): string {
  if (!name) return "-";

  const trimmed = name.trim();
  if (trimmed.length <= 1) return "*";
  if (trimmed.length === 2) return `${trimmed[0]}*`;

  return `${trimmed[0]}${"*".repeat(trimmed.length - 2)}${trimmed[trimmed.length - 1]}`;
}

/** 여러 사례의 care_logs log_id를 모은다(Storage 삭제 경로 계산용). */
export async function collectLogIdsForCases(
  supabase: SupabaseClient,
  caseIds: string[],
  onlyCaregiverId?: string | null
): Promise<string[]> {
  if (caseIds.length === 0) return [];

  let query = supabase.from("care_logs").select("log_id").in("case_id", caseIds);

  if (onlyCaregiverId) {
    query = query.eq("caregiver_id", onlyCaregiverId);
  }

  const { data } = await query;
  return (data || []).map((row: { log_id: string }) => row.log_id);
}

/**
 * Storage(care-log-photos 버킷)에서 해당 간병일지들의 사진 파일을 지운다.
 * RLS 정책이 전제하는 경로 규칙(`{log_id}/파일명`)을 그대로 사용한다.
 * DB보다 먼저 호출한다 — 파일 삭제가 실패하면 DB는 건드리지 않고 중단한다.
 */
export async function deleteStorageForLogIds(
  supabase: SupabaseClient,
  logIds: string[]
): Promise<{ removed: number; failedLogIds: string[] }> {
  let removed = 0;
  const failedLogIds: string[] = [];

  for (const logId of logIds) {
    const { data: files, error: listError } = await supabase.storage
      .from(CARE_LOG_PHOTO_BUCKET)
      .list(logId);

    if (listError) {
      failedLogIds.push(logId);
      continue;
    }

    if (!files || files.length === 0) {
      continue;
    }

    const paths = files.map((file) => `${logId}/${file.name}`);

    const { error: removeError } = await supabase.storage
      .from(CARE_LOG_PHOTO_BUCKET)
      .remove(paths);

    if (removeError) {
      failedLogIds.push(logId);
      continue;
    }

    removed += paths.length;
  }

  return { removed, failedLogIds };
}

async function countPhotosForCaseIds(
  supabase: SupabaseClient,
  caseIds: string[],
  onlyCaregiverId?: string | null
): Promise<number> {
  const logIds = await collectLogIdsForCases(supabase, caseIds, onlyCaregiverId);
  if (logIds.length === 0) return 0;

  const { count } = await supabase
    .from("care_log_photos")
    .select("*", { count: "exact", head: true })
    .in("log_id", logIds);

  return count || 0;
}

/** 휴대폰(=caregiver) 기준 Preview */
export async function buildPhonePreview(
  supabase: SupabaseClient,
  phoneNormalized: string
): Promise<TestResetPreview> {
  const counts = emptyCounts();

  const { data: caregiver } = await supabase
    .from("caregivers")
    .select("caregiver_id, caregiver_name")
    .eq("phone_normalized", phoneNormalized)
    .maybeSingle();

  if (!caregiver) {
    return {
      mode: "phone",
      found: false,
      target_id: null,
      target_label: "등록되지 않은 번호",
      counts,
      cases: [],
    };
  }

  counts.caregivers = 1;

  const { data: links } = await supabase
    .from("case_caregivers")
    .select("case_id")
    .eq("caregiver_id", caregiver.caregiver_id);

  const caseIds = (links || []).map((row: { case_id: string }) => row.case_id);
  counts.case_caregivers = caseIds.length;

  const cases: TestResetCaseSummary[] = [];

  if (caseIds.length > 0) {
    const { data: caseRows } = await supabase
      .from("cases")
      .select("case_id, case_no, patient_name, status")
      .in("case_id", caseIds);

    const { data: allLinks } = await supabase
      .from("case_caregivers")
      .select("case_id, caregiver_id")
      .in("case_id", caseIds);

    const linkCountByCase = new Map<string, number>();
    for (const link of allLinks || []) {
      linkCountByCase.set(link.case_id, (linkCountByCase.get(link.case_id) || 0) + 1);
    }

    const { data: logRows } = await supabase
      .from("care_logs")
      .select("case_id")
      .in("case_id", caseIds)
      .eq("caregiver_id", caregiver.caregiver_id);

    const logCountByCase = new Map<string, number>();
    for (const log of logRows || []) {
      logCountByCase.set(log.case_id, (logCountByCase.get(log.case_id) || 0) + 1);
    }

    for (const row of caseRows || []) {
      const linkedCaregiverCount = linkCountByCase.get(row.case_id) || 0;

      cases.push({
        case_id: row.case_id,
        case_no: row.case_no,
        patient_name_masked: maskPersonName(row.patient_name),
        status: row.status,
        care_log_count: logCountByCase.get(row.case_id) || 0,
        linked_caregiver_count: linkedCaregiverCount,
        case_will_be_deleted: linkedCaregiverCount <= 1,
      });
    }

    counts.cases = cases.filter((item) => item.case_will_be_deleted).length;
    counts.care_logs = logRows?.length || 0;
    counts.care_log_photos = await countPhotosForCaseIds(
      supabase,
      caseIds,
      caregiver.caregiver_id
    );

    const { count: consentCount } = await supabase
      .from("case_consents")
      .select("*", { count: "exact", head: true })
      .eq("caregiver_id", caregiver.caregiver_id);

    counts.consents = consentCount || 0;

    // 삭제 대상 사례들에 달린 등록 건. 실제 삭제도 case_id 기준으로
    // 이뤄지므로(reset_test_case_data) preview도 같은 기준으로 센다.
    const { count: registrationCount } = await supabase
      .from("caregiver_registrations")
      .select("*", { count: "exact", head: true })
      .in("case_id", caseIds);

    counts.caregiver_registrations = registrationCount || 0;
  }

  const { count: sessionCount } = await supabase
    .from("caregiver_sessions")
    .select("*", { count: "exact", head: true })
    .eq("caregiver_id", caregiver.caregiver_id);

  counts.sessions = sessionCount || 0;

  const { count: otpCount } = await supabase
    .from("caregiver_otp_codes")
    .select("*", { count: "exact", head: true })
    .eq("phone_normalized", phoneNormalized);

  counts.otp_codes = otpCount || 0;

  return {
    mode: "phone",
    found: true,
    target_id: caregiver.caregiver_id,
    target_label: `간병인 ${maskPersonName(caregiver.caregiver_name)}`,
    counts,
    cases,
  };
}

async function buildCountsForCaseIds(
  supabase: SupabaseClient,
  caseIds: string[]
): Promise<TestResetCounts> {
  const counts = emptyCounts();

  if (caseIds.length === 0) return counts;

  counts.cases = caseIds.length;

  const { data: links } = await supabase
    .from("case_caregivers")
    .select("caregiver_id")
    .in("case_id", caseIds);

  counts.case_caregivers = links?.length || 0;

  const uniqueCaregiverIds = Array.from(
    new Set((links || []).map((row: { caregiver_id: string }) => row.caregiver_id))
  );

  const { count: logCount } = await supabase
    .from("care_logs")
    .select("*", { count: "exact", head: true })
    .in("case_id", caseIds);

  counts.care_logs = logCount || 0;
  counts.care_log_photos = await countPhotosForCaseIds(supabase, caseIds);

  const { count: consentCount } = await supabase
    .from("case_consents")
    .select("*", { count: "exact", head: true })
    .in("case_id", caseIds);

  counts.consents = consentCount || 0;

  const { count: registrationCount } = await supabase
    .from("caregiver_registrations")
    .select("*", { count: "exact", head: true })
    .in("case_id", caseIds);

  counts.caregiver_registrations = registrationCount || 0;

  const { count: historyCount } = await supabase
    .from("case_history")
    .select("*", { count: "exact", head: true })
    .in("case_id", caseIds);

  counts.histories = historyCount || 0;

  // 이 사례들 밖에 다른 연결이 없는 간병인만 삭제 대상이 된다.
  for (const caregiverId of uniqueCaregiverIds) {
    const { data: otherLinks } = await supabase
      .from("case_caregivers")
      .select("case_id")
      .eq("caregiver_id", caregiverId)
      .not("case_id", "in", `(${caseIds.join(",")})`);

    if (!otherLinks || otherLinks.length === 0) {
      counts.caregivers += 1;
    }

    const { count: sessionCount } = await supabase
      .from("caregiver_sessions")
      .select("*", { count: "exact", head: true })
      .eq("caregiver_id", caregiverId);

    counts.sessions += sessionCount || 0;

    const { data: caregiverRow } = await supabase
      .from("caregivers")
      .select("phone_normalized")
      .eq("caregiver_id", caregiverId)
      .maybeSingle();

    if (caregiverRow?.phone_normalized) {
      const { count: otpCount } = await supabase
        .from("caregiver_otp_codes")
        .select("*", { count: "exact", head: true })
        .eq("phone_normalized", caregiverRow.phone_normalized);

      counts.otp_codes += otpCount || 0;
    }
  }

  return counts;
}

/** 사례 기준 Preview */
export async function buildCasePreview(
  supabase: SupabaseClient,
  caseId: string
): Promise<TestResetPreview> {
  const { data: caseRow } = await supabase
    .from("cases")
    .select("case_id, case_no, patient_name, status")
    .eq("case_id", caseId)
    .maybeSingle();

  if (!caseRow) {
    return {
      mode: "case",
      found: false,
      target_id: null,
      target_label: "사례를 찾을 수 없음",
      counts: emptyCounts(),
      cases: [],
    };
  }

  const counts = await buildCountsForCaseIds(supabase, [caseId]);

  return {
    mode: "case",
    found: true,
    target_id: caseId,
    target_label: `사례 ${caseRow.case_no || caseId.slice(0, 8)} (${maskPersonName(
      caseRow.patient_name
    )})`,
    counts,
    cases: [
      {
        case_id: caseRow.case_id,
        case_no: caseRow.case_no,
        patient_name_masked: maskPersonName(caseRow.patient_name),
        status: caseRow.status,
        care_log_count: counts.care_logs,
        linked_caregiver_count: counts.case_caregivers,
        case_will_be_deleted: true,
      },
    ],
  };
}

/** 병원 기준 Preview */
export async function buildHospitalPreview(
  supabase: SupabaseClient,
  hospitalId: string
): Promise<TestResetPreview> {
  const { data: hospital } = await supabase
    .from("hospitals")
    .select("hospital_id, hospital_name")
    .eq("hospital_id", hospitalId)
    .maybeSingle();

  if (!hospital) {
    return {
      mode: "hospital",
      found: false,
      target_id: null,
      target_label: "병원을 찾을 수 없음",
      counts: emptyCounts(),
      cases: [],
    };
  }

  const { data: caseRows } = await supabase
    .from("cases")
    .select("case_id, case_no, patient_name, status")
    .eq("hospital_id", hospitalId);

  const caseIds = (caseRows || []).map((row: { case_id: string }) => row.case_id);
  const counts = await buildCountsForCaseIds(supabase, caseIds);

  return {
    mode: "hospital",
    found: true,
    target_id: hospitalId,
    target_label: `병원 ${hospital.hospital_name}`,
    counts,
    cases: (caseRows || []).map((row) => ({
      case_id: row.case_id,
      case_no: row.case_no,
      patient_name_masked: maskPersonName(row.patient_name),
      status: row.status,
      care_log_count: 0,
      linked_caregiver_count: 0,
      case_will_be_deleted: true,
    })),
  };
}

/** 감사 로그 summary 문자열(건수만, PII 없음) */
export function buildCountsSummary(counts: TestResetCounts): string {
  return [
    `간병인 ${counts.caregivers}`,
    `사례 ${counts.cases}`,
    `연결 ${counts.case_caregivers}`,
    `간병일지 ${counts.care_logs}`,
    `사진 ${counts.care_log_photos}`,
    `동의 ${counts.consents}`,
    `간병인 등록 ${counts.caregiver_registrations}`,
    `이력 ${counts.histories}`,
    `세션 ${counts.sessions}`,
    `OTP ${counts.otp_codes}`,
  ].join(", ");
}
