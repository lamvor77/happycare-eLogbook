import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export class AdminAuthError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AdminAuthError";
    this.status = status;
  }
}

function getAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS || "";

  return raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

async function getAdminSession() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return null;
  }

  const adminEmails = getAdminEmails();
  const email = user.email.toLowerCase();

  return { supabase, user, email, isAdmin: adminEmails.includes(email) };
}

/**
 * 간병인용 조회 화면(app/cases/[id] 등)에서 "관리자면 그냥 보여준다"는
 * 폴백으로 쓴다. 리다이렉트하지도 예외를 던지지도 않고, 관리자가 아니면
 * null을 돌려준다 — 호출부가 기존 간병인 흐름을 그대로 이어갈 수 있어야
 * 하기 때문이다.
 *
 * 관리자는 사례에 간병인으로 연결되어 있지 않으므로 case_caregivers 행이
 * 없다. 따라서 이 경로로 들어온 화면은 조회만 가능해야 하고, 현재 간병인
 * 변경·간병종료 같은 쓰기 기능을 노출해서는 안 된다(호출부에서 canManage를
 * false로 둔다). 실제 쓰기 API들도 각자 간병인 세션을 따로 검증하므로
 * 이 폴백만으로는 아무것도 바꿀 수 없다.
 *
 * 반환하는 supabase는 관리자 로그인 세션이 바인딩된 클라이언트다 — 조회는
 * cases/care_logs/care_log_photos의 is_admin() 정책을 타고 통과한다.
 */
export async function getAdminViewerSession() {
  const session = await getAdminSession();

  if (!session || !session.isAdmin) {
    return null;
  }

  return { supabase: session.supabase, email: session.email };
}

/**
 * 페이지(Server Component)에서 사용한다. 로그인 여부와 관리자 이메일 목록을
 * 서버에서 검증한다. 비로그인 -> /admin/login, 로그인했지만 비관리자 ->
 * /admin/access-denied 로 리다이렉트한다.
 *
 * 반환하는 supabase는 로그인 세션이 바인딩된 인증 클라이언트다. 관리자 페이지의
 * 데이터 조회는 반드시 이 클라이언트를 사용해야 한다("@/lib/supabase"의 anon
 * 싱글턴을 쓰지 않는다) — RLS 적용 후에도 관리자 자신의 세션으로 조회가
 * 통과해야 하기 때문이다.
 */
export async function requireAdmin() {
  const session = await getAdminSession();

  if (!session) {
    redirect("/admin/login");
  }

  if (!session.isAdmin) {
    redirect("/admin/access-denied");
  }

  return { supabase: session.supabase, user: session.user, email: session.email };
}

/**
 * Route Handler(API)에서 사용한다. 실패 시 리다이렉트 대신 AdminAuthError를
 * 던진다 — 호출부에서 catch 후 NextResponse.json으로 변환해서 사용한다.
 */
export async function requireAdminApi() {
  const session = await getAdminSession();

  if (!session) {
    throw new AdminAuthError("로그인이 필요합니다.", 401);
  }

  if (!session.isAdmin) {
    throw new AdminAuthError("관리자 권한이 없습니다.", 403);
  }

  return { supabase: session.supabase, user: session.user, email: session.email };
}
