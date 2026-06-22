import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { config } from "../config.js";
import { logger } from "../logger.js";

/**
 * Optional AES-256-GCM encryption for sensitive values (wallet addresses) at
 * rest. Enabled when WALLET_ENCRYPTION_KEY is set. The stored format is:
 *
 *   enc:v1:<iv-hex>:<authTag-hex>:<ciphertext-hex>
 *
 * Values without the `enc:` prefix are treated as plaintext (backwards
 * compatible / when encryption is disabled).
 */
const PREFIX = "enc:v1:";

let key: Buffer | null = null;
if (config.WALLET_ENCRYPTION_KEY) {
  key = Buffer.from(config.WALLET_ENCRYPTION_KEY, "hex");
} else {
  logger.warn(
    "WALLET_ENCRYPTION_KEY not set — wallet addresses are stored in plaintext. " +
      "Set a 64-hex-char key in production.",
  );
}

export function isEncryptionEnabled(): boolean {
  return key !== null;
}

export function encryptSecret(plaintext: string): string {
  if (!key) return plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored; // plaintext
  if (!key) {
    throw new Error(
      "Encrypted value present but WALLET_ENCRYPTION_KEY is not configured.",
    );
  }
  const [, , ivHex, tagHex, dataHex] = stored.split(":");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex!, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex!, "hex"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataHex!, "hex")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}
