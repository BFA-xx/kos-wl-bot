import { createDecipheriv } from "node:crypto";

const PREFIX = "enc:v1:";

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
