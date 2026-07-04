"use client";

import { PageTitle } from "@/components/ui";
import { TeamManager } from "@/components/TeamManager";

export default function TeamPage() {
  return (
    <>
      <PageTitle title="Team" subtitle="Invite teammates and manage their roles." />
      <TeamManager />
    </>
  );
}
