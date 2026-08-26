import type {
  Client,
  Guild,
  GuildMember,
  PartialGuildMember,
  User as DiscordUser,
} from "discord.js";
import { prisma, type Prisma } from "@kos/db";
import { logger } from "../logger.js";
import { ensureGuild } from "./userService.js";

const DEFAULT_RECONCILE_INTERVAL_MS = 60 * 60 * 1_000;
const GUILD_CONCURRENCY = 2;
const WRITE_BATCH_SIZE = 50;

interface GuildSyncState {
  lastAttemptAt: string | null;
  lastSuccessfulAt: string | null;
  lastError: string | null;
  syncedMembers: number;
}

/**
 * Mirrors Discord guild membership into PostgreSQL for authenticated external
 * consumers. Gateway events keep the snapshot fresh; a full hourly fetch
 * repairs any events missed while the bot was offline.
 */
export class GuildMemberSyncService {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly states = new Map<string, GuildSyncState>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly client: Client,
    private readonly intervalMs = DEFAULT_RECONCILE_INTERVAL_MS,
  ) {}

  start(): void {
    void this.reconcileAll();
    this.timer = setInterval(() => void this.reconcileAll(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  health(): unknown {
    return {
      intervalSeconds: Math.round(this.intervalMs / 1_000),
      inFlightGuilds: [...this.inFlight.keys()],
      guilds: Object.fromEntries(this.states.entries()),
    };
  }

  async reconcileAll(): Promise<void> {
    const guilds = [...this.client.guilds.cache.values()];
    for (let offset = 0; offset < guilds.length; offset += GUILD_CONCURRENCY) {
      await Promise.all(
        guilds
          .slice(offset, offset + GUILD_CONCURRENCY)
          .map((guild) => this.reconcileGuild(guild)),
      );
    }
  }

  reconcileGuild(guild: Guild): Promise<void> {
    const current = this.inFlight.get(guild.id);
    if (current) return current;

    const task = this.performReconcile(guild).finally(() => {
      this.inFlight.delete(guild.id);
    });
    this.inFlight.set(guild.id, task);
    return task;
  }

  async memberJoinedOrUpdated(member: GuildMember): Promise<void> {
    if (member.user.bot) return;
    const seenAt = new Date();
    await ensureGuild({
      id: member.guild.id,
      name: member.guild.name,
      iconUrl: member.guild.iconURL(),
    });
    await this.persistMembers(member.guild.id, [member], seenAt, true);
  }

  async memberLeft(member: GuildMember | PartialGuildMember): Promise<void> {
    if (member.user.bot) return;
    const seenAt = new Date();
    await ensureGuild({
      id: member.guild.id,
      name: member.guild.name,
      iconUrl: member.guild.iconURL(),
    });
    await this.persistMembers(member.guild.id, [member], seenAt, false);
  }

  async userUpdated(user: DiscordUser): Promise<void> {
    if (user.bot) return;
    const globalName = user.globalName ?? null;
    const avatarUrl = user.displayAvatarURL({ size: 128 });
    await prisma.$transaction([
      prisma.user.updateMany({
        where: { id: user.id },
        data: { username: user.username, globalName, avatarUrl },
      }),
      prisma.discordGuildMember.updateMany({
        where: { userId: user.id },
        data: { username: user.username, globalName, avatarUrl },
      }),
      prisma.discordGuildMember.updateMany({
        where: { userId: user.id, nickname: null },
        data: { displayName: globalName ?? user.username },
      }),
    ]);
  }

  private async performReconcile(guild: Guild): Promise<void> {
    const seenAt = new Date();
    const prior = this.states.get(guild.id);
    this.states.set(guild.id, {
      lastAttemptAt: seenAt.toISOString(),
      lastSuccessfulAt: prior?.lastSuccessfulAt ?? null,
      lastError: null,
      syncedMembers: prior?.syncedMembers ?? 0,
    });

    try {
      await ensureGuild({
        id: guild.id,
        name: guild.name,
        iconUrl: guild.iconURL(),
      });
      const fetched = await guild.members.fetch({ withPresences: false });
      const members = [...fetched.values()].filter(
        (member) => !member.user.bot,
      );

      for (
        let offset = 0;
        offset < members.length;
        offset += WRITE_BATCH_SIZE
      ) {
        await this.persistMembers(
          guild.id,
          members.slice(offset, offset + WRITE_BATCH_SIZE),
          seenAt,
          true,
        );
      }

      const departed = await prisma.discordGuildMember.updateMany({
        where: {
          guildId: guild.id,
          isActive: true,
          lastSeenAt: { lt: seenAt },
        },
        data: { isActive: false, leftAt: seenAt },
      });

      this.states.set(guild.id, {
        lastAttemptAt: seenAt.toISOString(),
        lastSuccessfulAt: new Date().toISOString(),
        lastError: null,
        syncedMembers: members.length,
      });
      logger.info(
        {
          guildId: guild.id,
          members: members.length,
          departed: departed.count,
        },
        "Discord guild member snapshot reconciled",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.states.set(guild.id, {
        lastAttemptAt: seenAt.toISOString(),
        lastSuccessfulAt: prior?.lastSuccessfulAt ?? null,
        lastError: message,
        syncedMembers: prior?.syncedMembers ?? 0,
      });
      logger.error(
        { err, guildId: guild.id },
        "Discord guild member snapshot reconciliation failed",
      );
    }
  }

  private async persistMembers(
    guildId: string,
    members: Array<GuildMember | PartialGuildMember>,
    seenAt: Date,
    isActive: boolean,
  ): Promise<void> {
    const operations: Prisma.PrismaPromise<unknown>[] = [];
    for (const member of members) {
      const user = member.user;
      const globalName = user.globalName ?? null;
      const avatarUrl = user.displayAvatarURL({ size: 128 });
      const common = {
        username: user.username,
        globalName,
        nickname: member.nickname ?? null,
        displayName: member.displayName || globalName || user.username,
        avatarUrl,
        joinedAt: member.joinedAt,
        lastSeenAt: seenAt,
        isActive,
        leftAt: isActive ? null : seenAt,
      };

      operations.push(
        prisma.user.upsert({
          where: { id: user.id },
          create: {
            id: user.id,
            username: user.username,
            globalName,
            avatarUrl,
          },
          update: { username: user.username, globalName, avatarUrl },
        }),
        prisma.discordGuildMember.upsert({
          where: { guildId_userId: { guildId, userId: user.id } },
          create: {
            guildId,
            userId: user.id,
            firstSeenAt: seenAt,
            ...common,
          },
          update: common,
        }),
      );
    }
    if (operations.length > 0) await prisma.$transaction(operations);
  }
}
