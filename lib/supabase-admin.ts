import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * service_role 키를 사용하는 서버 전용 클라이언트. RLS를 완전히 우회하므로
 * 신뢰할 수 있는 서버-서버 통합(예: 시크릿 헤더로 검증된 google-form-sync)
 * 에서만, 그리고 해당 검증을 통과한 뒤에만 생성해서 사용해야 한다.
 *
 * "server-only"를 import하고 있으므로 이 파일이 클라이언트 번들에 포함되면
 * 빌드 타임에 에러가 난다 — 실수로 브라우저 코드에서 import하는 것을 막는다.
 *
 * 환경변수 존재 여부는 이 함수가 실제로 호출될 때(요청 처리 시점)만
 * 검사한다. 모듈 최상단에서 검사하면 SUPABASE_SERVICE_ROLE_KEY가 아직
 * 설정되지 않은 환경(예: 로컬 개발, 이 값을 쓰지 않는 다른 라우트의 빌드)
 * 에서 이 모듈이 import되는 것만으로 예기치 않게 실패할 수 있기 때문이다.
 */
export function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다. 서버 환경변수 설정을 확인하세요."
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
