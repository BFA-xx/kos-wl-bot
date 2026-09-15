import { getValidAccessToken } from "@/lib/auth";
import {
  fetchUserGuildsResult,
  type DiscordGuildsResult,
} from "@/lib/discord-oauth";

/**
 * The Discord servers a member is in, read with their own OAuth token so the
 * list never depends on the bot being in a server. `ok: false` means the
 * membership is unknown (no token, refresh failed, Discord unreachable) —
 * callers should say so rather than treat it as "in no servers".
 */
export async function fetchMemberGuilds(
  userId: string,
): Promise<DiscordGuildsResult> {
  try {
    const token = await getValidAccessToken(userId);
    return token
      ? await fetchUserGuildsResult(token)
      : { ok: false, guilds: [] };
  } catch {
    return { ok: false, guilds: [] };
  }
}
