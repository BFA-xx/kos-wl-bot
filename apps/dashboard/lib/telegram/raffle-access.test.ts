import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import type { User as TelegramUser } from "grammy/types";

const mocks = vi.hoisted(() => ({
  memberFindUnique: vi.fn(),
  memberCreate: vi.fn(),
  memberUpdate: vi.fn(),
  accountFindUnique: vi.fn(),
  participantFindUnique: vi.fn(),
  evaluateWebGates: vi.fn(),
  fetchGuildMember: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    telegramCommunityMember: {
      findUnique: mocks.memberFindUnique,
      create: mocks.memberCreate,
      update: mocks.memberUpdate,
    },
    connectedAccount: { findUnique: mocks.accountFindUnique },
    participant: { findUnique: mocks.participantFindUnique },
  },
}));

vi.mock("@/lib/raffle-entry", () => ({
  evaluateWebGates: mocks.evaluateWebGates,
  fetchGuildMember: mocks.fetchGuildMember,
}));

import {
  evaluateTelegramRaffleAccess,
  type TelegramRaffleCheck,
} from "@/lib/telegram/raffle-access";

const telegramUser = { id: 42, first_name: "Whale" } as TelegramUser;
const community = {
  id: "community-1",
  telegramChatId: "-1001",
  communityName: "KOS Raffles",
} as never;
const raffle = {
  id: 7,
  status: "LIVE",
  guildId: "guild-1",
  eligibleRoles: [],
} as never;

function makeCtx(memberStatus = "member") {
  return {
    api: {
      getChatMember: vi.fn().mockResolvedValue({ status: memberStatus }),
    },
  } as unknown as Context;
}

function checkFor(checks: TelegramRaffleCheck[], key: string) {
  return checks.find((check) => check.key === key);
}

describe("Telegram raffle pre-flight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.memberFindUnique.mockResolvedValue({
      id: "member-1",
      status: "ACTIVE",
      approvalStatus: "APPROVED",
      identityId: "identity-1",
    });
    mocks.accountFindUnique.mockResolvedValue({
      id: "account-1",
      userId: "discord-1",
      user: { id: "discord-1", username: "whale" },
    });
    mocks.participantFindUnique.mockResolvedValue(null);
    mocks.evaluateWebGates.mockResolvedValue({ gates: [], canEnter: true });
    mocks.fetchGuildMember.mockResolvedValue({ roles: [], joined_at: null });
  });

  it("clears every check and carries what the entry needs", async () => {
    const access = await evaluateTelegramRaffleAccess(
      makeCtx(),
      telegramUser,
      "identity-1",
      community,
      raffle,
    );
    expect(access.canEnter).toBe(true);
    expect(access.block).toBeNull();
    expect(access.ready?.accountId).toBe("account-1");
    expect(access.checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("stops at community membership and leaves later checks unresolved", async () => {
    mocks.memberFindUnique.mockResolvedValue(null);
    const ctx = makeCtx("left");

    const access = await evaluateTelegramRaffleAccess(
      ctx,
      telegramUser,
      "identity-1",
      community,
      raffle,
    );

    expect(access.block).toBe("not_in_community");
    expect(access.canEnter).toBe(false);
    expect(checkFor(access.checks, "community")?.status).toBe("fail");
    expect(checkFor(access.checks, "approval")?.status).toBe("pending");
    expect(checkFor(access.checks, "requirements")?.status).toBe("pending");
    // The expensive checks must not run once something earlier blocks.
    expect(mocks.evaluateWebGates).not.toHaveBeenCalled();
    expect(mocks.fetchGuildMember).not.toHaveBeenCalled();
  });

  it("separates a pending review from a rejected one", async () => {
    mocks.memberFindUnique.mockResolvedValue({
      id: "member-1",
      status: "ACTIVE",
      approvalStatus: "PENDING",
      identityId: "identity-1",
    });
    const pending = await evaluateTelegramRaffleAccess(
      makeCtx(),
      telegramUser,
      "identity-1",
      community,
      raffle,
    );
    expect(pending.block).toBe("approval_pending");

    mocks.memberFindUnique.mockResolvedValue({
      id: "member-1",
      status: "ACTIVE",
      approvalStatus: "REJECTED",
      identityId: "identity-1",
    });
    const rejected = await evaluateTelegramRaffleAccess(
      makeCtx(),
      telegramUser,
      "identity-1",
      community,
      raffle,
    );
    expect(rejected.block).toBe("approval_rejected");
  });

  it("offers a profile link when Telegram is not connected to KOS", async () => {
    mocks.accountFindUnique.mockResolvedValue(null);
    const access = await evaluateTelegramRaffleAccess(
      makeCtx(),
      telegramUser,
      "identity-1",
      community,
      raffle,
    );
    expect(access.block).toBe("not_linked");
    expect(access.actionUrl).toContain("/me");
  });

  it("treats an existing entry as a state, not a failure", async () => {
    mocks.participantFindUnique.mockResolvedValue({ id: 1 });
    const access = await evaluateTelegramRaffleAccess(
      makeCtx(),
      telegramUser,
      "identity-1",
      community,
      raffle,
    );
    expect(access.alreadyEntered).toBe(true);
    expect(access.canEnter).toBe(false);
    expect(access.block).toBeNull();
    expect(mocks.fetchGuildMember).not.toHaveBeenCalled();
  });

  it("surfaces the failing gate reason instead of a generic message", async () => {
    mocks.evaluateWebGates.mockResolvedValue({
      canEnter: false,
      gates: [
        { key: "role", label: "Role", ok: false, reason: "You need @holder." },
        { key: "age", label: "Account age", ok: true },
      ],
    });
    const access = await evaluateTelegramRaffleAccess(
      makeCtx(),
      telegramUser,
      "identity-1",
      community,
      raffle,
    );
    expect(access.block).toBe("requirements");
    expect(checkFor(access.checks, "requirements")?.detail).toContain(
      "You need @holder.",
    );
    expect(access.requirements).toEqual({
      gates: [
        { key: "role", label: "Role", ok: false, reason: "You need @holder." },
      ],
      discordOnly: false,
    });
    expect(mocks.fetchGuildMember).not.toHaveBeenCalled();
  });

  it("keeps repeated requirement failures structured for private recovery", async () => {
    const url = "/me/raffles?raffle=7";
    mocks.evaluateWebGates.mockResolvedValue({
      canEnter: false,
      discordOnly: false,
      gates: [
        {
          key: "follow",
          label: "Follow",
          ok: false,
          reason: "Verify it.",
          url,
        },
        { key: "like", label: "Like", ok: false, reason: "Verify it.", url },
        {
          key: "retweet",
          label: "Retweet",
          ok: false,
          reason: "Verify it.",
          url,
        },
      ],
    });

    const access = await evaluateTelegramRaffleAccess(
      makeCtx(),
      telegramUser,
      "identity-1",
      community,
      raffle,
    );

    expect(access.message).toBe("Verify it.");
    expect(access.requirements?.gates.map(({ label }) => label)).toEqual([
      "Follow",
      "Like",
      "Retweet",
    ]);
  });

  it("blocks when Discord membership cannot be confirmed", async () => {
    mocks.fetchGuildMember.mockResolvedValue("not_member");
    const access = await evaluateTelegramRaffleAccess(
      makeCtx(),
      telegramUser,
      "identity-1",
      community,
      raffle,
    );
    expect(access.block).toBe("discord_unconfirmed");
    expect(access.ready).toBeNull();
  });

  it("refuses a raffle that is not open yet", async () => {
    const access = await evaluateTelegramRaffleAccess(
      makeCtx(),
      telegramUser,
      "identity-1",
      community,
      { ...(raffle as object), status: "UPCOMING" } as never,
    );
    expect(access.block).toBe("not_live");
    expect(checkFor(access.checks, "status")?.detail).toContain(
      "not opened yet",
    );
  });
});
