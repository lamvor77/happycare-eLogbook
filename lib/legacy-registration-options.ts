import "server-only";
import { ACCIDENT_TYPE_OPTIONS } from "@/lib/registration-options";

/**
 * 기존 가족간병관리 시스템(Google Form)의 "보험사" 질문 선택지를 서버가
 * 대신 조회해온다 — 이 저장소는 보험사 목록을 마스터로 갖지 않는다(작업
 * 15~19). 브라우저는 이 파일의 환경변수(URL/시크릿)를 알지 못하고, 오직
 * `app/api/registration-options/route.ts`를 통해서만 결과를 받는다.
 *
 * 캐시 정책(작업 18 — Apps Script 장애 시 전체 등록 마비 방지):
 *   - 마지막으로 성공한 응답을 모듈 메모리에 짧게 캐시한다(TTL 5분).
 *   - TTL 안에는 캐시를 그대로 쓴다(요청마다 외부 호출 방지).
 *   - TTL이 지났는데 재조회가 실패하면, "가장 최근에 성공했던 목록"을
 *     그대로 다시 내려준다(신선하지 않아도 완전히 막히는 것보다 낫다).
 *   - 서버가 재시작된 뒤 첫 조회부터 실패하면(캐시가 아예 없음), 빈
 *     목록 + ok:false를 반환한다 — 이 경우에도 임의의 보험사 목록을
 *     지어내지 않는다.
 *   - 사고유형은 실제 값이 이미 확인되어 있으므로(작업 11), 응답에 값이
 *     없거나 조회 자체가 실패해도 `ACCIDENT_TYPE_OPTIONS` 고정값으로
 *     항상 대체한다(사용자 흐름을 막지 않기 위함).
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;

interface LegacyRegistrationOptions {
  insuranceCompanies: string[];
  accidentTypes: string[];
}

interface CacheEntry {
  value: LegacyRegistrationOptions;
  fetchedAt: number;
}

let cache: CacheEntry | null = null;

function fallbackAccidentTypes(): string[] {
  return ACCIDENT_TYPE_OPTIONS.map((option) => option.value);
}

export interface FetchLegacyRegistrationOptionsResult {
  ok: boolean;
  insuranceCompanies: string[];
  accidentTypes: string[];
  /** true면 방금 조회한 최신 값이 아니라 마지막으로 성공했던 캐시를 쓴 것. */
  stale: boolean;
}

export async function fetchLegacyRegistrationOptions(): Promise<FetchLegacyRegistrationOptionsResult> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { ok: true, ...cache.value, stale: false };
  }

  const configUrl = process.env.LEGACY_FAMILYCARE_CONFIG_URL;
  const secret = process.env.LEGACY_FAMILYCARE_WEBHOOK_SECRET;

  if (!configUrl) {
    if (cache) {
      return { ok: false, ...cache.value, stale: true };
    }
    return { ok: false, insuranceCompanies: [], accidentTypes: fallbackAccidentTypes(), stale: false };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(configUrl, {
      method: "GET",
      headers: secret ? { "x-legacy-sync-secret": secret } : {},
      signal: controller.signal,
      // 이 값은 등록 화면마다 최신일 필요가 있으므로 Next.js의 fetch 캐시를
      // 쓰지 않는다 — 위 모듈 메모리 캐시가 그 역할을 대신한다.
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`config endpoint ${response.status}`);
    }

    const body = await response.json();

    const insuranceCompanies = Array.isArray(body?.insurance_companies)
      ? body.insurance_companies.filter((item: unknown) => typeof item === "string")
      : [];

    const accidentTypes = Array.isArray(body?.accident_types)
      ? body.accident_types.filter((item: unknown) => typeof item === "string")
      : [];

    const value: LegacyRegistrationOptions = {
      insuranceCompanies,
      accidentTypes: accidentTypes.length > 0 ? accidentTypes : fallbackAccidentTypes(),
    };

    cache = { value, fetchedAt: Date.now() };

    return { ok: true, ...value, stale: false };
  } catch (error) {
    console.error(
      "기존 시스템 등록옵션(보험사) 조회 실패:",
      error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error"
    );

    if (cache) {
      return { ok: false, ...cache.value, stale: true };
    }

    return { ok: false, insuranceCompanies: [], accidentTypes: fallbackAccidentTypes(), stale: false };
  } finally {
    clearTimeout(timeout);
  }
}
