import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { AcceptInvite } from "@/components/AcceptInvite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function InvitePage({ params }: { params: { token: string } }) {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${params.token}`)}`);

  const invite = await prisma.organizationInvite.findUnique({
    where: { token: params.token },
    include: { organization: true, role: { select: { name: true } } },
  });

  const invalid = !invite || invite.acceptedAt || invite.expiresAt < new Date();

  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <div className="w-full max-w-sm rounded-2xl border border-kos-border bg-kos-panel/60 p-8 text-center backdrop-blur-xl">
        {invalid ? (
          <>
            <h1 className="text-lg font-semibold">Invite unavailable</h1>
            <p className="mt-2 text-sm text-kos-muted">
              This invite is invalid, already used, or expired.
            </p>
            <a href="/" className="kos-btn mt-5 inline-block">
              Go home
            </a>
          </>
        ) : (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-kos-fg text-sm font-black text-kos-bg">
              {invite!.organization.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={invite!.organization.logoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                invite!.organization.name.slice(0, 2).toUpperCase()
              )}
            </div>
            <h1 className="mt-4 text-lg font-semibold">Join {invite!.organization.name}</h1>
            <p className="mt-1 text-sm text-kos-muted">
              You've been invited as <strong className="text-kos-fg">{invite!.role.name}</strong>.
            </p>
            <AcceptInvite token={params.token} slug={invite!.organization.slug} />
          </>
        )}
      </div>
    </div>
  );
}
