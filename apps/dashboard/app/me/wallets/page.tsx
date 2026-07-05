import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { PageTitle } from "@/components/ui";
import { WalletsEditor } from "@/components/WalletsEditor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function MeWalletsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/me/wallets");

  return (
    <>
      <PageTitle
        title="My wallets"
        subtitle="Payout addresses used when you win — manage them here or with /wallet in Discord."
      />
      <WalletsEditor />
    </>
  );
}
