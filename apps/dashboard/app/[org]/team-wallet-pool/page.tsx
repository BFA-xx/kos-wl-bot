"use client";

import { PageTitle } from "@/components/ui";
import { TeamWalletPoolManager } from "@/components/TeamWalletPoolManager";

export default function TeamWalletPoolPage() {
  return (
    <>
      <PageTitle
        title="Team Wallet Pool"
        subtitle="Maintain validated team wallets and rotate them into completed raffle exports."
      />
      <TeamWalletPoolManager />
    </>
  );
}
