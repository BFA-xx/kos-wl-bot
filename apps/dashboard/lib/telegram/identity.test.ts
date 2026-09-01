import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { syncTelegramIdentity } from "@/lib/telegram/identity";

describe("KOS Telegram identity", () => {
  it("creates a provider-neutral identity keyed by immutable Telegram id", async () => {
    let created:
      | {
          displayName: string;
          legacyUserId: string | null;
          accounts: { create: { externalId: string; username: string | null } };
        }
      | undefined;
    const tx = {
      identityAccount: {
        findUnique: async () => null,
      },
      kosIdentity: {
        create: async ({ data }: { data: typeof created }) => {
          created = data;
          return {
            id: "identity-1",
            displayName: data?.displayName ?? "",
            legacyUserId: data?.legacyUserId ?? null,
            status: "ACTIVE",
            onboardingStatus: "STARTED",
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      },
    } as unknown as Prisma.TransactionClient;

    const result = await syncTelegramIdentity(
      tx,
      {
        id: 987654321,
        is_bot: false,
        first_name: "Ada",
        last_name: "Builder",
        username: "mutable_handle",
      },
      null,
    );

    expect(result.isNew).toBe(true);
    expect(created?.displayName).toBe("Ada Builder");
    expect(created?.accounts.create.externalId).toBe("987654321");
    expect(created?.accounts.create.username).toBe("mutable_handle");
  });

  it("bridges an existing Telegram identity to the KOS product account", async () => {
    let accountUpdate: Record<string, unknown> | undefined;
    let identityUpdate: Record<string, unknown> | undefined;
    const tx = {
      identityAccount: {
        findUnique: async () => ({
          id: "account-1",
          identityId: "identity-1",
          identity: {
            id: "identity-1",
            legacyUserId: null,
            displayName: "Ada",
            status: "ACTIVE",
            onboardingStatus: "STARTED",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          accountUpdate = data;
          return { id: "account-1" };
        },
      },
      kosIdentity: {
        findUnique: async () => null,
        update: async ({ data }: { data: Record<string, unknown> }) => {
          identityUpdate = data;
          return {
            id: "identity-1",
            displayName: String(data.displayName),
            legacyUserId: String(data.legacyUserId),
            status: "ACTIVE",
            onboardingStatus: "COMPLETED",
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      },
    } as unknown as Prisma.TransactionClient;

    const result = await syncTelegramIdentity(
      tx,
      {
        id: 987654321,
        is_bot: false,
        first_name: "Ada",
        username: "new_handle",
      },
      "discord-user-1",
    );

    expect(result.isNew).toBe(false);
    expect(accountUpdate?.username).toBe("new_handle");
    expect(identityUpdate).toMatchObject({
      legacyUserId: "discord-user-1",
      onboardingStatus: "COMPLETED",
    });
  });
});
