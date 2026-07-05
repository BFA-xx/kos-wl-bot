import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getUserOrgs } from "@/lib/access";

export const dynamic = "force-dynamic";

/**
 * Root router. Org managers land on their org dashboard; everyone else lands
 * on their personal KOS profile (community members are first-class — they can
 * enter raffles, manage wallets and browse communities from /me). Creating an
 * org stays one click away via /me/communities → "Create your own".
 */
export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const orgs = await getUserOrgs(user.id);
  if (orgs.length === 0) redirect("/me");
  redirect(`/${orgs[0].slug}/dashboard`);
}
