import { randomBytes } from "node:crypto";
import { decryptSecret, encryptionKey, encryptSecret } from "@/server/lib/crypto";

const key = randomBytes(32);

describe("crypto", () => {
  it("cifra e decifra, e nunca cifra igual duas vezes", () => {
    const a = encryptSecret("1//refresh-token-ção", key);
    const b = encryptSecret("1//refresh-token-ção", key);
    expect(a).not.toBe(b);
    expect(a).not.toContain("refresh-token");
    expect(decryptSecret(a, key)).toBe("1//refresh-token-ção");
    expect(decryptSecret(b, key)).toBe("1//refresh-token-ção");
  });

  it("não decifra com outra chave nem um texto mexido", () => {
    const encrypted = encryptSecret("segredo", key);
    expect(() => decryptSecret(encrypted, randomBytes(32))).toThrow();
    const parts = encrypted.split(".");
    parts[3] = Buffer.from("outro").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
    expect(() => decryptSecret("nao-e-nada", key)).toThrow(/formato/);
  });

  it("lê a chave em hex ou em base64, e recusa uma chave curta ou em falta", () => {
    expect(encryptionKey({ ENCRYPTION_KEY: key.toString("hex") })).toEqual(key);
    expect(encryptionKey({ ENCRYPTION_KEY: key.toString("base64") })).toEqual(key);
    expect(() => encryptionKey({ ENCRYPTION_KEY: "curta" })).toThrow(/ENCRYPTION_KEY/);
    expect(() => encryptionKey({})).toThrow(/ENCRYPTION_KEY/);
  });
});
