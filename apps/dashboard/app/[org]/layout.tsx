import { redirect, notFound } from "next/navigation";
import { AccessError, requireOrgAccess, getUserOrgs } from "@/lib/access";
import { OrgShell } from "@/components/OrgShell";

export const dynamic = "force-dynamic";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { org: string };
}) {
  let access;
  try {
    access = await requireOrgAccess(params.org);
  } catch (err) {
    if (err instanceof AccessError) {
      if (err.status === 401) {
        redirect(`/login?next=${encodeURIComponent(`/${params.org}/dashboard`)}`);
      }
      if (err.status === 404) notFound();
      redirect("/"); // 403 — bounce to their own orgs
    }
    throw err;
  }

  const { user, org, isOwner, permissions } = access;
  const orgs = await getUserOrgs(user.id);

  const ctx = {
    slug: org.slug,
    name: org.name,
    logoUrl: org.logoUrl,
    isOwner,
    isSuperAdmin: user.isSuperAdmin,
    permissions,
    user: {
      id: user.id,
      name: user.globalName ?? user.username,
      avatarUrl: user.avatarUrl,
    },
    orgs: orgs.map((o) => ({ slug: o.slug, name: o.name, logoUrl: o.logoUrl })),
  };

  return <OrgShell ctx={ctx}>{children}</OrgShell>;
}
