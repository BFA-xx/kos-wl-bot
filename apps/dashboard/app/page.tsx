import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getUserOrgs } from "@/lib/access";

export const dynamic = "force-dynamic";

/**
 * Root router. Sends the signed-in user to their org (or onboarding). The
 * middleware already redirects unauthenticated requests to /login.
 */
export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const orgs = await getUserOrgs(user.id);
  if (orgs.length === 0) redirect("/onboarding");
  redirect(`/${orgs[0].slug}/dashboard`);
}
