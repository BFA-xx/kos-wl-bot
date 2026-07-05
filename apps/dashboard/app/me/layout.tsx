import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { MeShell } from "@/components/MeShell";

export const dynamic = "force-dynamic";

/** Participant space — any signed-in Discord user, no org membership needed. */
export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/me");

  return (
    <MeShell user={{ name: user.globalName ?? user.username, avatarUrl: user.avatarUrl }}>
      {children}
    </MeShell>
  );
}
