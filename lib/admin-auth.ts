import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

function getAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS || "";

  return raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * 로그인 여부와 관리자 이메일 목록을 서버에서 검증한다.
 * 비로그인 -> /admin/login, 로그인했지만 비관리자 -> /admin/access-denied 로 리다이렉트한다.
 */
export async function requireAdmin() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    redirect("/admin/login");
  }

  const adminEmails = getAdminEmails();
  const email = user.email.toLowerCase();

  if (!adminEmails.includes(email)) {
    redirect("/admin/access-denied");
  }

  return { user, email };
}
