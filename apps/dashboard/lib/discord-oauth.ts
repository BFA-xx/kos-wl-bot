/**
 * Discord OAuth2 helpers (Phase 2).
 *
 * Login authenticates ANY Discord user — access to a specific organization is
 * enforced separately by membership + permissions (see lib/access.ts). We
 * request `guilds` so the linking flow can list servers the user manages, and
 * store refresh tokens so we can call Discord on their behalf later.
 */
export const OAUTH_SCOPES = [
  "identify",
  "email",
  "guilds",
  "guilds.members.read",
];

/** Discord permission bit for MANAGE_GUILD. */
const MANAGE_GUILD = 1n << 5n; // 0x20

export function oauthConfigured(): boolean {
  return Boolean(
    process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET,
  );
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

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  token_type: string;
  scope: string;
}

export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<TokenResponse | null> {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<TokenResponse | null> {
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

async function tokenRequest(
  fields: Record<string, string>,
): Promise<TokenResponse | null> {
  const res = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID!,
      client_secret: process.env.DISCORD_CLIENT_SECRET!,
      ...fields,
    }),
  });
  if (!res.ok) return null;
  return (await res.json()) as TokenResponse;
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  email?: string | null;
}

export async function fetchUser(token: string): Promise<DiscordUser | null> {
  const res = await fetch("https://discord.com/api/users/@me", {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as DiscordUser;
}

export interface DiscordGuildSummary {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string; // stringified bitfield
}

export interface DiscordGuildsResult {
  ok: boolean;
  guilds: DiscordGuildSummary[];
}

/** Guild membership lookup with an explicit success signal for member UI. */
export async function fetchUserGuildsResult(
  token: string,
): Promise<DiscordGuildsResult> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch("https://discord.com/api/users/@me/guilds", {
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        return {
          ok: true,
          guilds: (await res.json()) as DiscordGuildSummary[],
        };
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === 3) return { ok: false, guilds: [] };

      const delayMs = await discordRetryDelay(res, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch {
      if (attempt === 3) return { ok: false, guilds: [] };
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  return { ok: false, guilds: [] };
}

async function discordRetryDelay(
  response: Response,
  attempt: number,
): Promise<number> {
  let retryAfter = Number(response.headers.get("retry-after"));
  if (!Number.isFinite(retryAfter) && response.status === 429) {
    try {
      const body = (await response.clone().json()) as { retry_after?: unknown };
      retryAfter = Number(body.retry_after);
    } catch {
      // Fall through to bounded exponential backoff.
    }
  }
  return Number.isFinite(retryAfter)
    ? Math.min(5_000, Math.max(100, retryAfter * 1_000))
    : 250 * 2 ** attempt;
}

/** Guilds the user is in (from their token). */
export async function fetchUserGuilds(
  token: string,
): Promise<DiscordGuildSummary[]> {
  return (await fetchUserGuildsResult(token)).guilds;
}

/** True if the user owns the guild or holds MANAGE_GUILD. */
export function canManageGuild(g: DiscordGuildSummary): boolean {
  if (g.owner) return true;
  try {
    return (BigInt(g.permissions) & MANAGE_GUILD) === MANAGE_GUILD;
  } catch {
    return false;
  }
}

/** The user's manageable guilds only, for the "connect a server" picker. */
export async function fetchManageableGuilds(
  token: string,
): Promise<DiscordGuildSummary[]> {
  return (await fetchUserGuilds(token)).filter(canManageGuild);
}

export function avatarUrl(user: DiscordUser): string | null {
  if (!user.avatar) return null;
  const ext = user.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
}

export function guildIconUrl(g: {
  id: string;
  icon: string | null;
}): string | null {
  if (!g.icon) return null;
  return `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`;
}

/**
 * Bot invite URL. If a guildId is given, Discord preselects that server and
 * hides the picker so the owner just clicks "Authorize".
 */
export function botInviteUrl(guildId?: string): string {
  const clientId = process.env.DISCORD_CLIENT_ID ?? "";
  // View Channels, Send Messages, Embed Links, Attach Files, Read History,
  // Mention Everyone, Add Reactions, Use External Emojis, Manage Messages.
  const params = new URLSearchParams({
    client_id: clientId,
    scope: "bot applications.commands",
    permissions: "519232",
  });
  if (guildId) {
    params.set("guild_id", guildId);
    params.set("disable_guild_select", "true");
  }
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function botToken(): string | undefined {
  return process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN;
}

export function hasBotToken(): boolean {
  return Boolean(botToken());
}

/** Text + announcement channels of a guild (needs the bot token). */
export async function fetchGuildChannels(
  guildId: string,
): Promise<{ id: string; name: string }[]> {
  const token = botToken();
  if (!token) return [];
  const res = await fetch(
    `https://discord.com/api/guilds/${guildId}/channels`,
    {
      headers: { authorization: `Bot ${token}` },
    },
  );
  if (!res.ok) return [];
  const all = (await res.json()) as {
    id: string;
    name: string;
    type: number;
    position: number;
  }[];
  return all
    .filter((c) => c.type === 0 || c.type === 5) // text + announcement
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ id: c.id, name: c.name }));
}

/** Assignable roles of a guild, excluding @everyone and bot-managed roles. */
export async function fetchGuildRoles(
  guildId: string,
): Promise<{ id: string; name: string }[]> {
  const token = botToken();
  if (!token) return [];
  const res = await fetch(`https://discord.com/api/guilds/${guildId}/roles`, {
    headers: { authorization: `Bot ${token}` },
  });
  if (!res.ok) return [];
  const all = (await res.json()) as {
    id: string;
    name: string;
    managed: boolean;
    position: number;
  }[];
  return all
    .filter((r) => r.id !== guildId && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name }));
}

/**
 * Verify the KOS bot is present in a guild using the BOT token (server-side).
 * 200 ⇒ the bot is a member.
 */
export async function botIsInGuild(guildId: string): Promise<boolean> {
  const botToken = process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN;
  if (!botToken) return false;
  const res = await fetch(`https://discord.com/api/guilds/${guildId}`, {
    headers: { authorization: `Bot ${botToken}` },
  });
  return res.ok;
}
