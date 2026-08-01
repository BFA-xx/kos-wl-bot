import { describe, expect, it } from "vitest";
import { canManageAllTeamWallets } from "./team-wallet-server";

const access = (isOwner: boolean, roleName: string | null) =>
  ({
    isOwner,
    member: roleName ? { role: { name: roleName } } : null,
  }) as Parameters<typeof canManageAllTeamWallets>[0];

describe("Team Wallet Pool management permissions", () => {
  it("allows owners and Admins to manage every team member's wallets", () => {
    expect(canManageAllTeamWallets(access(true, null))).toBe(true);
    expect(canManageAllTeamWallets(access(false, "Admin"))).toBe(true);
  });

  it("keeps Collab Managers and regular members owner-scoped", () => {
    expect(canManageAllTeamWallets(access(false, "Collab Manager"))).toBe(
      false,
    );
    expect(canManageAllTeamWallets(access(false, "Viewer"))).toBe(false);
  });
});
