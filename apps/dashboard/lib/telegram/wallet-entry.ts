import {
  InlineKeyboard,
  type Api,
  type Bot,
  type Context,
  type NextFunction,
} from "grammy";
import type { WalletChain } from "@prisma/client";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { isUnchangedMessage } from "@/lib/telegram/edit-or-reply";
import { escapeTelegramHtml } from "@/lib/telegram/format";
import {
  isWalletChain,
  validateWalletAddress,
  walletChainHint,
  walletChainLabel,
} from "@/lib/wallet-validation";

/**
 * In-chat wallet entry for linked Telegram members, on one message.
 *
 * When a raffle's wallet gate fails, the private checklist offers one button
 * per accepted chain. Tapping it turns that same checklist message into the
 * address prompt (⬅️ Back returns to the checklist, ✖️ Cancel ends the step).
 * The member's typed address is deleted once read, and the result — an error
 * to fix, or "saved" with Retry entry — is drawn on the same message, so the
 * whole step leaves one message behind, not five. The address is validated
 * and encrypted exactly like the website's Wallets page.
 */

const CONVERSATION_TTL_MS = 10 * 60_000;
/** Buttons offered per raffle; the website link covers any beyond this. */
export const MAX_WALLET_BUTTONS = 4;
const CANCEL_DATA = "w:x";

interface WalletConversationPayload {
  chain: WalletChain;
  tokenId: string;
  /** The checklist message the step took over. */
  messageId: number;
}

export function walletCallbackData(tokenId: string, chain: WalletChain) {
  return `w:${tokenId}:${chain}`;
}

export function parseWalletCallback(
  data: string,
): { tokenId: string; chain: WalletChain } | null {
  const match = /^w:([A-Za-z0-9_-]+):([A-Z]+)$/u.exec(data);
  if (!match || !isWalletChain(match[2])) return null;
  return { tokenId: match[1], chain: match[2] };
}

export function walletButtonLabel(chain: WalletChain): string {
  return `Add ${walletChainLabel(chain)} wallet`.slice(0, 64);
}

/** Wallet buttons for the chains a raffle accepts, in registry order. */
export function addWalletButtons(
  keyboard: InlineKeyboard,
  tokenId: string,
  chains: readonly WalletChain[],
): void {
  for (const chain of chains.slice(0, MAX_WALLET_BUTTONS)) {
    keyboard
      .text(walletButtonLabel(chain), walletCallbackData(tokenId, chain))
      .row();
  }
}

export function walletPromptScreen(
  chain: WalletChain,
  tokenId: string,
  error?: string,
): { text: string; keyboard: InlineKeyboard } {
  const label = escapeTelegramHtml(walletChainLabel(chain));
  return {
    text: [
      `<b>ADD YOUR ${label.toUpperCase()} ADDRESS</b>`,
      "",
      ...(error
        ? [
            `That isn't a valid ${label} address. ${escapeTelegramHtml(error)}`,
            "",
          ]
        : []),
      `Send the address as your next message (${escapeTelegramHtml(walletChainHint(chain))}).`,
      "It is saved to your KOS profile, the same as the website's Wallets page.",
    ].join("\n"),
    // Back re-runs the entry check, which redraws the checklist here.
    keyboard: new InlineKeyboard()
      .text("⬅️ Back", `a:${tokenId}`)
      .text("✖️ Cancel", CANCEL_DATA),
  };
}

export function walletSavedScreen(
  chain: WalletChain,
  tokenId: string,
): { text: string; keyboard: InlineKeyboard } {
  return {
    text: [
      `<b>${escapeTelegramHtml(walletChainLabel(chain)).toUpperCase()} WALLET SAVED</b>`,
      "",
      "Tap Retry entry to enter the raffle.",
    ].join("\n"),
    keyboard: new InlineKeyboard()
      .text("Retry entry", `a:${tokenId}`)
      .row()
      .text("Back to raffles", "raffles:list"),
  };
}

/**
 * Edit the step's message, or send a new one when it is gone. Never throws;
 * resolves to the message now showing the screen.
 */
async function paint(
  api: Api,
  chatId: number,
  messageId: number | undefined,
  screen: { text: string; keyboard: InlineKeyboard },
): Promise<number | undefined> {
  const options = {
    parse_mode: "HTML" as const,
    link_preview_options: { is_disabled: true },
    reply_markup: screen.keyboard,
  };
  if (messageId) {
    try {
      await api.editMessageText(chatId, messageId, screen.text, options);
      return messageId;
    } catch (error) {
      if (isUnchangedMessage(error)) return messageId;
      // Deleted or too old to edit: carry on in a new message.
    }
  }
  return api
    .sendMessage(chatId, screen.text, options)
    .then((sent) => sent.message_id)
    .catch(() => messageId);
}

async function linkedUserId(telegramUserId: number): Promise<string | null> {
  const account = await prisma.connectedAccount.findUnique({
    where: {
      provider_externalId: {
        provider: "TELEGRAM",
        externalId: String(telegramUserId),
      },
    },
    select: { userId: true },
  });
  return account?.userId ?? null;
}

function conversationKey(chatId: number, telegramUserId: number) {
  return {
    telegramChatId: String(chatId),
    telegramUserId: String(telegramUserId),
    kind: "WALLET_ADDRESS" as const,
  };
}

async function startWalletEntry(ctx: Context): Promise<void> {
  const parsed = parseWalletCallback(ctx.callbackQuery?.data ?? "");
  const message = ctx.callbackQuery?.message;
  if (!parsed || !ctx.from || !message) {
    await ctx.answerCallbackQuery();
    return;
  }
  if (message.chat.type !== "private") {
    await ctx.answerCallbackQuery({
      text: "Open the bot's private chat to add a wallet.",
      show_alert: true,
    });
    return;
  }
  const token = await prisma.integrationActionToken.findUnique({
    where: { id: parsed.tokenId },
    include: {
      publication: {
        include: { raffle: { select: { walletChains: true } } },
      },
    },
  });
  const raffle = token?.publication?.raffle;
  if (
    !token ||
    token.expiresAt <= new Date() ||
    !raffle ||
    !raffle.walletChains.includes(parsed.chain)
  ) {
    await ctx.answerCallbackQuery({
      text: "This button is no longer active.",
      show_alert: true,
    });
    return;
  }
  if (!(await linkedUserId(ctx.from.id))) {
    await ctx.answerCallbackQuery({
      text: "Connect Telegram from your KOS profile first.",
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery();
  const messageId = await paint(
    ctx.api,
    message.chat.id,
    message.message_id,
    walletPromptScreen(parsed.chain, parsed.tokenId),
  );
  const payload: WalletConversationPayload = {
    chain: parsed.chain,
    tokenId: parsed.tokenId,
    messageId: messageId ?? message.message_id,
  };
  const key = conversationKey(message.chat.id, ctx.from.id);
  const expiresAt = new Date(Date.now() + CONVERSATION_TTL_MS);
  await prisma.telegramConversation.upsert({
    where: { telegramChatId_telegramUserId_kind: key },
    create: {
      ...key,
      communityId: token.publication!.communityId,
      step: "ADDRESS",
      payload: { ...payload },
      expiresAt,
    },
    update: { step: "ADDRESS", payload: { ...payload }, expiresAt },
  });
}

/**
 * Close the member's open wallet step, if any. Retry entry and ⬅️ Back share
 * the entry button, so pressing either leaves the step; without this the next
 * thing they typed would be read as an address.
 */
export async function closeWalletStep(ctx: Context): Promise<void> {
  const chat = ctx.callbackQuery?.message?.chat;
  if (!ctx.from || chat?.type !== "private") return;
  await prisma.telegramConversation.deleteMany({
    where: conversationKey(chat.id, ctx.from.id),
  });
}

async function cancelWalletEntry(ctx: Context): Promise<void> {
  const message = ctx.callbackQuery?.message;
  await ctx.answerCallbackQuery();
  if (!ctx.from || !message) return;
  await prisma.telegramConversation.deleteMany({
    where: conversationKey(message.chat.id, ctx.from.id),
  });
  await paint(ctx.api, message.chat.id, message.message_id, {
    text: "Wallet step cancelled. Nothing was saved.",
    keyboard: new InlineKeyboard().text("Back to raffles", "raffles:list"),
  });
}

/**
 * Consumes the typed address. This is a `message:text` catch-all, so it MUST
 * call `next()` on every path where it does not handle the message, or every
 * handler registered after it goes silent.
 */
async function handleWalletAddressText(
  ctx: Context,
  next: NextFunction,
): Promise<void> {
  if (
    !ctx.from ||
    !ctx.chat ||
    ctx.chat.type !== "private" ||
    !ctx.message?.text ||
    ctx.message.text.startsWith("/")
  ) {
    await next();
    return;
  }
  const conversation = await prisma.telegramConversation.findUnique({
    where: {
      telegramChatId_telegramUserId_kind: conversationKey(
        ctx.chat.id,
        ctx.from.id,
      ),
    },
  });
  if (!conversation) {
    await next();
    return;
  }
  const payload = conversation.payload as unknown as WalletConversationPayload;
  if (!isWalletChain(payload?.chain)) {
    await prisma.telegramConversation.delete({
      where: { id: conversation.id },
    });
    await next();
    return;
  }

  // The address shows up in the redrawn screen; the bubble would be clutter
  // (and a pasted address is worth not leaving lying around).
  const chatId = ctx.chat.id;
  await ctx.api
    .deleteMessage(chatId, ctx.message.message_id)
    .catch(() => undefined);

  if (conversation.expiresAt <= new Date()) {
    await prisma.telegramConversation.delete({
      where: { id: conversation.id },
    });
    await paint(ctx.api, chatId, payload.messageId, {
      text: "That wallet step expired. Tap Retry entry to start again.",
      keyboard: new InlineKeyboard().text(
        "Retry entry",
        `a:${payload.tokenId}`,
      ),
    });
    return;
  }
  const userId = await linkedUserId(ctx.from.id);
  if (!userId) {
    await prisma.telegramConversation.delete({
      where: { id: conversation.id },
    });
    await paint(ctx.api, chatId, payload.messageId, {
      text: "Connect Telegram from your KOS profile first.",
      keyboard: new InlineKeyboard().text("Back to raffles", "raffles:list"),
    });
    return;
  }

  const result = validateWalletAddress(payload.chain, ctx.message.text);
  if (!result.ok) {
    const messageId = await paint(
      ctx.api,
      chatId,
      payload.messageId,
      walletPromptScreen(payload.chain, payload.tokenId, result.error),
    );
    if (messageId && messageId !== payload.messageId) {
      await prisma.telegramConversation.update({
        where: { id: conversation.id },
        data: { payload: { ...payload, messageId } },
      });
    }
    return;
  }

  const stored = encryptSecret(result.normalized);
  await prisma.$transaction([
    prisma.walletProfile.upsert({
      where: { userId_chain: { userId, chain: payload.chain } },
      create: { userId, chain: payload.chain, address: stored },
      update: { address: stored },
    }),
    prisma.telegramConversation.delete({ where: { id: conversation.id } }),
  ]);
  await paint(
    ctx.api,
    chatId,
    payload.messageId,
    walletSavedScreen(payload.chain, payload.tokenId),
  );
}

export function registerTelegramWalletHandlers(bot: Bot): void {
  bot.callbackQuery(CANCEL_DATA, cancelWalletEntry);
  bot.callbackQuery(/^w:[A-Za-z0-9_-]+:[A-Z]+$/u, startWalletEntry);
  bot.on("message:text", handleWalletAddressText);
}
