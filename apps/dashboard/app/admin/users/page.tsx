import { prisma } from "@/lib/db";
import { guardAdmin } from "@/lib/admin-guard";
import { PageTitle, StatCard } from "@/components/ui";
import { AddSuperAdmin, UserAdminToggle } from "@/components/admin/UserAdminControls";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminUsersPage() {
  const { user: me } = await guardAdmin();

  const [users, totalUsers, superAdmins] = await Promise.all([
    prisma.user.findMany({
      where: { OR: [{ lastLoginAt: { not: null } }, { isSuperAdmin: true }] },
      orderBy: [{ lastLoginAt: "desc" }],
      take: 200,
      include: { _count: { select: { memberships: true, ownedOrgs: true } } },
    }),
    prisma.user.count(),
    prisma.user.count({ where: { isSuperAdmin: true } }),
  ]);

  return (
    <>
      <PageTitle title="Users" subtitle="Everyone who has signed in to KOS." />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Known users" value={totalUsers} />
        <StatCard label="Dashboard users" value={users.length} />
        <StatCard accent label="Super admins" value={superAdmins} />
      </div>

      <AddSuperAdmin />

      <div className="overflow-hidden rounded-2xl border border-kos-border">
        <table className="w-full text-sm">
          <thead className="bg-kos-panel/60 text-left text-xs uppercase tracking-wide text-kos-muted">
            <tr>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3 text-right">Orgs</th>
              <th className="hidden px-4 py-3 md:table-cell">Last login</th>
              <th className="px-4 py-3 text-right">Super admin</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-kos-border/60">
                <td className="px-4 py-3">
                  <div className="font-medium">
                    {u.globalName ?? u.username}
                    {u.isSuperAdmin ? (
                      <span className="ml-2 rounded border border-red-500/30 px-1.5 py-0.5 text-[10px] text-red-400">
                        admin
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-kos-muted">{u.id}</div>
                </td>
                <td className="px-4 py-3 text-kos-muted">{u.email ?? "—"}</td>
                <td className="px-4 py-3 text-right">{u._count.memberships}</td>
                <td className="hidden px-4 py-3 text-kos-muted md:table-cell">
                  {u.lastLoginAt ? fmtDate(u.lastLoginAt) : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <UserAdminToggle id={u.id} isSuperAdmin={u.isSuperAdmin} isSelf={u.id === me.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
