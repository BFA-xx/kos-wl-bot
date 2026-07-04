import { redirect } from "next/navigation";
import { AccessError, requireSuperAdmin } from "@/lib/access";
import { AdminShell } from "@/components/AdminShell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let user;
  try {
    ({ user } = await requireSuperAdmin());
  } catch (err) {
    if (err instanceof AccessError) {
      if (err.status === 401) redirect("/login?next=/admin");
      redirect("/"); // 403 — community owners can never see admin
    }
    throw err;
  }

  return (
    <AdminShell user={{ name: user.globalName ?? user.username, avatarUrl: user.avatarUrl }}>
      {children}
    </AdminShell>
  );
}
