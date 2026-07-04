import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

/**
 * Encrypt a secret (OAuth tokens) at rest with AES-256-GCM, format
 * `enc:v1:<iv>:<tag>:<data>` (all hex). Same scheme + key the bot uses for
 * wallets. If no key is configured, returns the value unchanged (dev only).
 */
export function encryptSecret(plain: string): string {
  const keyHex = process.env.WALLET_ENCRYPTION_KEY;
  if (!keyHex) return plain;
  const key = Buffer.from(keyHex, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

/**
 * Mirror of the bot's wallet decryption so the dashboard can export plaintext
 * addresses. Shares WALLET_ENCRYPTION_KEY with the bot.
 */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const keyHex = process.env.WALLET_ENCRYPTION_KEY;
  if (!keyHex) return "[encrypted]";
  const key = Buffer.from(keyHex, "hex");
  const [, , ivHex, tagHex, dataHex] = stored.split(":");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex!, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex!, "hex"));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(dataHex!, "hex")),
      decipher.final(),
    ]);
    return dec.toString("utf8");
  } catch {
    return "[decrypt-error]";
  }
}
