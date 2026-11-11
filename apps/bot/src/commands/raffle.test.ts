import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@kos/db";
import type { ChatInputCommandInteraction } from "discord.js";
import { raffleCommand } from "./raffle.js";
import { config } from "../config.js";
import { winnersCsv } from "../proof/csv.js";

test("Discord raffle export registers all four Google Sheets reports", () => {
  const command = raffleCommand.data.toJSON();
  const sub = command.options?.find((option) => option.name === "export") as {
    options?: { name: string; choices?: { value: string }[] }[];
  };
  assert.deepEqual(
    sub.options
      ?.find((option) => option.name === "type")
      ?.choices?.map((choice) => choice.value),
    ["winners", "addresses", "full", "participants"],
  );
  assert.equal(
    sub.options?.some((option) => option.name === "as"),
    false,
  );
});

test("Discord exports return Sheets links for all report types and never attach CSVs", async (t) => {
  const previousUrl = config.DASHBOARD_URL;
  const previousToken = config.BOT_API_TOKEN;
  config.DASHBOARD_URL = "https://example.com";
  config.BOT_API_TOKEN = "test-token";
  t.after(() => {
    config.DASHBOARD_URL = previousUrl;
    config.BOT_API_TOKEN = previousToken;
  });
  const originalFind = prisma.raffle.findUnique;
  prisma.raffle.findUnique = (async () => ({
    guildId: "guild",
  })) as unknown as typeof originalFind;
  t.after(() => {
    prisma.raffle.findUnique = originalFind;
  });
  let status = 200;
  const fetchMock = t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      assert.ok(
        ["winners", "addresses", "full", "participants"].includes(body.type),
      );
      return new Response(
        JSON.stringify(
          status === 200
            ? {
                url: "https://docs.google.com/spreadsheets/d/test",
                rowCount: 1,
                failedEditors: [],
              }
            : { error: "Google unavailable" },
        ),
        { status },
      );
    },
  );
  for (const type of ["winners", "addresses", "full", "participants"]) {
    let reply: any;
    const interaction = {
      guildId: "guild",
      user: { id: "actor" },
      options: {
        getSubcommand: () => "export",
        getInteger: () => 301,
        getString: () => type,
      },
      deferReply: async () => {},
      editReply: async (value: unknown) => {
        reply = value;
      },
    } as unknown as ChatInputCommandInteraction;
    await raffleCommand.execute(interaction);
    assert.equal(reply.files, undefined);
    assert.equal(
      reply.components[0].toJSON().components[0].url,
      "https://docs.google.com/spreadsheets/d/test",
    );
    status = 503;
    await raffleCommand.execute(interaction);
    assert.equal(typeof reply, "string");
    assert.match(reply, /Couldn't open the Google Sheet/);
    status = 200;
  }
  assert.equal(fetchMock.mock.callCount(), 8);
});

test("winner CSV contains only Discord ID, username and wallet address", () => {
  const csv = winnersCsv([
    {
      position: 1,
      userId: "123456789012345678",
      username: "alice",
      address: "0xabc",
      chain: "ETHEREUM",
      submittedAt: new Date(),
    },
  ]);
  assert.equal(
    csv.replace(/^\uFEFF/, "").split("\r\n")[0],
    "discord_id,username,wallet_address",
  );
  assert.ok(!csv.includes("ETHEREUM"));
});
