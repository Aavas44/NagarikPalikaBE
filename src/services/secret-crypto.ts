import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";

function encryptionKey(): Buffer {
  const secret =
    process.env.GEMINI_KEY_ENCRYPTION_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    "nagarik-palika-dev-secret-change-in-production";
  return createHash("sha256").update(secret).digest();
}

/** Encrypt a UTF-8 secret; returns `iv:tag:ciphertext` (base64 parts). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid ciphertext");
  }
  const decipher = createDecipheriv(
    ALGO,
    encryptionKey(),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function keyHintFromSecret(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 4) return trimmed;
  return trimmed.slice(-4);
}
