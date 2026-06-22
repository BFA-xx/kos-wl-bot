import { prisma } from "@/lib/db";

/**
 * Discord OAuth2 helpers. Authorizes a user if they are a member of the
 * configured guild AND (are in the allowlist, or hold a manager role). If
 * neither an allowlist nor manager roles are configured yet, any guild member
 * is allowed (so the owner can get in during setup — lock down afterwards).
 */
export const OAUTH_SCOPES = ["identify", "guilds.members.read"];

export function oauthConfigured(): boolean {
  return Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);
}

function guildId(): string | undefined {
  return process.env.DISCORD_GUILD_ID || process.env.DASHBOARD_GUILD_ID || undefined;
}

export function buildAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: OAUTH_SCOPES.join(" "),
    state,
    prompt: "consent",
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
}

export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<TokenResponse | null> {
  const res = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID!,
      client_secret: process.env.DISCORD_CLIENT_SECRET!,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) return null;
  return (await res.json()) as TokenResponse;
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
}

export async function fetchUser(token: string): Promise<DiscordUser | null> {
  const res = await fetch("https://discord.com/api/users/@me", {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as DiscordUser;
}

interface GuildMember {
  roles: string[];
}

/** Authorize the user; returns { ok, reason }. */
export async function authorizeUser(
  token: string,
  userId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const gid = guildId();
  if (!gid) {
    // No guild configured — allow any successful Discord login.
    return { ok: true };
  }

  const res = await fetch(`https://discord.com/api/users/@me/guilds/${gid}/member`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    return { ok: false, reason: "You're not a member of this server." };
  }
  const member = (await res.json()) as GuildMember;

  const allowlist = (process.env.DASHBOARD_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowlist.includes(userId)) return { ok: true };

  const guild = await prisma.guild
    .findUnique({ where: { id: gid }, select: { managerRoleIds: true } })
    .catch(() => null);
  const managerRoleIds = guild?.managerRoleIds ?? [];

  if (managerRoleIds.some((r) => member.roles.includes(r))) return { ok: true };

  // Unconfigured: allow any guild member during initial setup.
  if (allowlist.length === 0 && managerRoleIds.length === 0) return { ok: true };

  return { ok: false, reason: "You don't have a manager role for the dashboard." };
}
