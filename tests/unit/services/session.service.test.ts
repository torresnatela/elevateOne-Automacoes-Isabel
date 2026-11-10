import { SignJWT } from "jose";
import { createSessionToken, verifySessionToken } from "@/server/services/session.service";

const payload = {
  userId: "11111111-1111-1111-1111-111111111111",
  role: "ADMIN" as const,
  name: "Admin",
  email: "admin@x.com",
};

describe("session.service", () => {
  it("assina e verifica um token válido", async () => {
    const token = await createSessionToken(payload);
    const session = await verifySessionToken(token);
    expect(session).toMatchObject(payload);
  });

  it("retorna null para token adulterado", async () => {
    const token = await createSessionToken(payload);
    const [header, body, signature] = token.split(".");
    const tampered = [header, body, signature.split("").reverse().join("")].join(".");
    await expect(verifySessionToken(tampered)).resolves.toBeNull();
  });

  it("retorna null para token assinado com outro segredo", async () => {
    const token = await new SignJWT({ ...payload })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("outro-segredo-outro-segredo-outro-segredo"));
    await expect(verifySessionToken(token)).resolves.toBeNull();
  });

  it("retorna null para token expirado", async () => {
    const token = await createSessionToken(payload, { expiresInSeconds: -10 });
    await expect(verifySessionToken(token)).resolves.toBeNull();
  });

  it("retorna null para valor vazio ou lixo", async () => {
    await expect(verifySessionToken(undefined)).resolves.toBeNull();
    await expect(verifySessionToken("lixo")).resolves.toBeNull();
  });
});
