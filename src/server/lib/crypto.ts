import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "v1";

/** A chave de 32 bytes, de `ENCRYPTION_KEY` (64 caracteres hex ou base64). */
export function encryptionKey(env: Record<string, string | undefined> = process.env): Buffer {
  const raw = env.ENCRYPTION_KEY ?? "";
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32)
    throw new Error("ENCRYPTION_KEY em falta ou inválida: gere com `openssl rand -hex 32`.");
  return key;
}

/** Cifra um segredo para guardar no banco (AES-256-GCM): `v1.iv.tag.dados`, em base64url. */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [PREFIX, iv, cipher.getAuthTag(), data]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

/** Decifra o que `encryptSecret` cifrou. Falha se a chave for outra ou se o texto foi mexido. */
export function decryptSecret(encrypted: string, key: Buffer): string {
  const [prefix, iv, tag, data] = encrypted.split(".");
  if (prefix !== PREFIX || !iv || !tag || data === undefined)
    throw new Error("Segredo cifrado num formato desconhecido.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
