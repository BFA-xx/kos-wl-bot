import { createServer, type Server, type IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { Client } from "discord.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { closeAndDraw, rerollWinners, type RerollMode } from "../services/winnerService.js";

/**
 * Minimal internal control API for the dashboard. Exposes the few actions that
 * require the live Discord client (ending a raffle, rerolling winners) so the
 * dashboard can trigger real announcements. Bound to localhost and protected
 * by a bearer token; intended to sit behind the same host / reverse proxy.
 */
export function startInternalApi(client: Client): Server | undefined {
  if (!config.INTERNAL_API_PORT) return undefined;
  if (!config.INTERNAL_API_TOKEN) {
    logger.warn("INTERNAL_API_PORT set but INTERNAL_API_TOKEN missing — internal API disabled");
    return undefined;
  }
  const token = config.INTERNAL_API_TOKEN;

  const server = createServer((req, res) => {
    void handle(req, res, client, token);
  });

  server.listen(config.INTERNAL_API_PORT, config.INTERNAL_API_HOST, () => {
    logger.info(
      { port: config.INTERNAL_API_PORT, host: config.INTERNAL_API_HOST },
      "internal control API listening",
    );
  });
  return server;
}

async function handle(
  req: IncomingMessage,
  res: import("node:http").ServerResponse,
  client: Client,
  token: string,
): Promise<void> {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/internal/health") {
      return json(200, { ok: true, ready: client.isReady() });
    }

    if (!authorized(req.headers.authorization, token)) {
      return json(401, { error: "unauthorized" });
    }

    const endMatch = url.pathname.match(/^\/internal\/raffles\/(\d+)\/end$/u);
    if (req.method === "POST" && endMatch) {
      const id = Number(endMatch[1]);
      const body = await readJson(req);
      await closeAndDraw(client, id, body.actorId ?? null);
      return json(200, { ok: true });
    }

    const rerollMatch = url.pathname.match(/^\/internal\/raffles\/(\d+)\/reroll$/u);
    if (req.method === "POST" && rerollMatch) {
      const id = Number(rerollMatch[1]);
      const body = await readJson(req);
      const result = await rerollWinners(client, id, body.actorId ?? "dashboard", {
        mode: (body.mode as RerollMode) ?? "all",
        userIds: body.userIds,
        count: body.count,
      });
      return json(result ? 200 : 400, { ok: Boolean(result), result });
    }

    return json(404, { error: "not_found" });
  } catch (err) {
    logger.error({ err }, "internal API error");
    return json(500, { error: "internal_error" });
  }
}

function authorized(header: string | undefined, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

async function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}
