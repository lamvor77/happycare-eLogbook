#!/usr/bin/env node
/**
 * RLS smoke test — staging 전용. 운영 프로젝트를 가리키는 값으로 실행하지
 * 말 것. 사용법은 docs/rls-rollout.md의 "smoke test 스크립트 사용법" 절
 * 참고.
 *
 * 실행 예:
 *   node --env-file=.env.rls-smoke-test scripts/rls-smoke-test.mjs
 *
 * 필요 환경변수(실제 값은 이 저장소 어디에도 커밋하지 않는다):
 *   SUPABASE_URL                 - staging 프로젝트 URL
 *   SUPABASE_ANON_KEY             - staging anon key
 *   CAREGIVER_ACCESS_TOKEN        - "현재 간병인"으로 로그인한 테스트 계정의
 *                                    access_token (Supabase Auth 세션 JWT)
 *   NON_CURRENT_CAREGIVER_TOKEN   - 같은 case에 연결되어 있지만 현재
 *                                    간병인은 아닌 테스트 계정의 access_token
 *                                    (선택 — 없으면 6번 테스트를 건너뜀)
 *   ADMIN_ACCESS_TOKEN            - admin_users에 등록된 테스트 관리자 계정의
 *                                    access_token
 *   TEST_CASE_ID                  - CAREGIVER_ACCESS_TOKEN 계정이 연결된 case_id
 *   TEST_QR_TOKEN                 - 활성 병원 하나의 qr_token
 *   OTHER_CASE_ID                 - (선택) 테스트 caregiver와 무관한 case_id.
 *                                    없으면 무작위 UUID를 써서 "존재하지
 *                                    않는 case" 조회로 대체한다.
 *   RUN_WRITE_TEST=1              - 7번(현재 간병인 insert 성공) 테스트를
 *                                    실제로 실행한다. care_logs는 delete
 *                                    정책이 없어 생성된 테스트 행을 다시
 *                                    지울 수 없으므로 기본값은 비활성화다.
 *
 * access_token을 얻는 방법: 실제 앱에서 로그인한 뒤 브라우저 개발자도구
 * Application/Storage 탭에서 Supabase 세션(localStorage의
 * `sb-<project>-auth-token` 항목)의 access_token 필드를 복사하거나,
 * `supabase.auth.getSession()`으로 콘솔에서 직접 확인한다. 이 토큰은
 * 비밀값에 준하므로 셸 히스토리/CI 로그에 남기지 않도록 주의할 것.
 */

import { createClient } from "@supabase/supabase-js";

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  CAREGIVER_ACCESS_TOKEN,
  NON_CURRENT_CAREGIVER_TOKEN,
  ADMIN_ACCESS_TOKEN,
  TEST_CASE_ID,
  TEST_QR_TOKEN,
  OTHER_CASE_ID,
  RUN_WRITE_TEST,
} = process.env;

const results = [];

function record(name, passed, detail) {
  results.push({ name, passed, detail });
  const mark = passed ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${detail ? " - " + detail : ""}`);
}

function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.log(`(건너뜀: 환경변수 누락 - ${missing.join(", ")})`);
    return false;
  }
  return true;
}

function anonClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function tokenClient(token) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function main() {
  if (!requireEnv(["SUPABASE_URL", "SUPABASE_ANON_KEY"])) {
    console.log("SUPABASE_URL / SUPABASE_ANON_KEY 없이는 아무 테스트도 실행할 수 없습니다.");
    process.exit(1);
  }

  // 1) anon으로 caregivers 조회 실패(빈 결과여야 함)
  {
    const supabase = anonClient();
    const { data, error } = await supabase.from("caregivers").select("*");
    const passed = !error && Array.isArray(data) && data.length === 0;
    record("1. anon으로 caregivers 조회 실패", passed, error ? error.message : `rows=${data?.length}`);
  }

  // 2) anon으로 cases 전체 조회 실패(빈 결과여야 함)
  {
    const supabase = anonClient();
    const { data, error } = await supabase.from("cases").select("*");
    const passed = !error && Array.isArray(data) && data.length === 0;
    record("2. anon으로 cases 전체 조회 실패", passed, error ? error.message : `rows=${data?.length}`);
  }

  // 3) 공개 병원 lookup만 성공
  if (requireEnv(["TEST_QR_TOKEN"])) {
    const supabase = anonClient();
    const { data, error } = await supabase.rpc("get_public_hospital", {
      p_qr_token: TEST_QR_TOKEN,
    });
    const row = Array.isArray(data) ? data[0] : data;
    const passed = !error && row && row.hospital_id;
    const hasOnlyMinimalColumns =
      row && Object.keys(row).every((key) =>
        ["hospital_id", "hospital_name", "hospital_address", "status"].includes(key)
      );
    record(
      "3. 공개 병원 lookup 성공",
      Boolean(passed && hasOnlyMinimalColumns),
      error ? error.message : `columns=${row ? Object.keys(row).join(",") : "none"}`
    );
  } else {
    record("3. 공개 병원 lookup 성공", false, "TEST_QR_TOKEN 없음 - 건너뜀");
  }

  // 4) caregiver 본인 case 조회 성공
  if (requireEnv(["CAREGIVER_ACCESS_TOKEN", "TEST_CASE_ID"])) {
    const supabase = tokenClient(CAREGIVER_ACCESS_TOKEN);
    const { data, error } = await supabase
      .from("cases")
      .select("case_id")
      .eq("case_id", TEST_CASE_ID);
    const passed = !error && Array.isArray(data) && data.length === 1;
    record("4. caregiver 본인 case 조회 성공", passed, error ? error.message : `rows=${data?.length}`);
  } else {
    record("4. caregiver 본인 case 조회 성공", false, "CAREGIVER_ACCESS_TOKEN/TEST_CASE_ID 없음 - 건너뜀");
  }

  // 5) 다른 case 조회 실패
  if (requireEnv(["CAREGIVER_ACCESS_TOKEN"])) {
    const otherCaseId = OTHER_CASE_ID || "00000000-0000-0000-0000-000000000000";
    const supabase = tokenClient(CAREGIVER_ACCESS_TOKEN);
    const { data, error } = await supabase
      .from("cases")
      .select("case_id")
      .eq("case_id", otherCaseId);
    const passed = !error && Array.isArray(data) && data.length === 0;
    record("5. 다른 case 조회 실패", passed, error ? error.message : `rows=${data?.length}`);
  } else {
    record("5. 다른 case 조회 실패", false, "CAREGIVER_ACCESS_TOKEN 없음 - 건너뜀");
  }

  // 6) 비현재 간병인의 care_logs insert 실패(항상 실패해야 하므로 데이터
  //    오염 위험 없음 - RUN_WRITE_TEST 플래그와 무관하게 실행)
  if (requireEnv(["NON_CURRENT_CAREGIVER_TOKEN", "TEST_CASE_ID"])) {
    const supabase = tokenClient(NON_CURRENT_CAREGIVER_TOKEN);
    const { error } = await supabase.from("care_logs").insert({
      case_id: TEST_CASE_ID,
      care_date: new Date().toISOString().slice(0, 10),
      location_status: "unavailable",
      location_failure_reason: "smoke_test",
    });
    const passed = Boolean(error);
    record("6. 비현재 간병인 care_log insert 실패", passed, error ? error.message : "insert가 성공해버림(문제)");
  } else {
    record("6. 비현재 간병인 care_log insert 실패", false, "NON_CURRENT_CAREGIVER_TOKEN/TEST_CASE_ID 없음 - 건너뜀");
  }

  // 7) 현재 간병인 insert 성공 — 기본은 dry-run 설명만 출력.
  //    care_logs는 delete 정책이 없어(감사 로그 성격) 한 번 생성한 테스트
  //    행을 되돌릴 방법이 없다. RUN_WRITE_TEST=1일 때만 실제로 실행한다.
  if (RUN_WRITE_TEST === "1") {
    if (requireEnv(["CAREGIVER_ACCESS_TOKEN", "TEST_CASE_ID"])) {
      const supabase = tokenClient(CAREGIVER_ACCESS_TOKEN);
      const { error } = await supabase.from("care_logs").insert({
        case_id: TEST_CASE_ID,
        care_date: new Date().toISOString().slice(0, 10),
        location_status: "unavailable",
        location_failure_reason: "smoke_test",
        memo: "[SMOKE TEST] rls-smoke-test.mjs",
      });
      const passed = !error;
      record(
        "7. 현재 간병인 care_log insert 성공",
        passed,
        error
          ? error.message
          : "실제로 insert됨 - care_logs에는 delete 정책이 없어 이 테스트 행이 영구적으로 남습니다. 필요 시 관리자가 별도로 정리하세요."
      );
    } else {
      record("7. 현재 간병인 care_log insert 성공", false, "CAREGIVER_ACCESS_TOKEN/TEST_CASE_ID 없음 - 건너뜀");
    }
  } else {
    console.log(
      "[SKIP] 7. 현재 간병인 care_log insert 성공 - RUN_WRITE_TEST=1이 아니므로 실제 실행하지 않음.\n" +
        "       (dry-run 설명) 이 테스트는 TEST_CASE_ID에서 오늘 날짜로 이미 작성된 기록이 없는 상태에서\n" +
        "       CAREGIVER_ACCESS_TOKEN 계정이 care_logs.insert를 호출하면 성공해야 함을 확인합니다.\n" +
        "       실제로 실행하면 care_logs에 영구적인 테스트 행이 남으므로(delete 정책 없음) 기본은 비활성화."
    );
  }

  // 8) 관리자 조회 성공
  if (requireEnv(["ADMIN_ACCESS_TOKEN"])) {
    const supabase = tokenClient(ADMIN_ACCESS_TOKEN);
    const { data: isAdminData, error: isAdminError } = await supabase.rpc("is_admin");
    const { data: casesData, error: casesError } = await supabase.from("cases").select("case_id");
    const passed = !isAdminError && isAdminData === true && !casesError && Array.isArray(casesData);
    record(
      "8. 관리자 조회 성공",
      passed,
      isAdminError?.message || casesError?.message || `is_admin=${isAdminData}, visible_cases=${casesData?.length}`
    );
  } else {
    record("8. 관리자 조회 성공", false, "ADMIN_ACCESS_TOKEN 없음 - 건너뜀");
  }

  const failed = results.filter((r) => !r.passed);
  console.log("\n=== 요약 ===");
  console.log(`총 ${results.length}건 중 실패 ${failed.length}건`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("스모크 테스트 실행 중 오류:", error.message);
  process.exitCode = 1;
});
