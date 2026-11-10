import { hashPassword, verifyPassword } from "@/server/services/password.service";

describe("password.service", () => {
  it("gera um hash diferente da senha original", async () => {
    const hash = await hashPassword("Senha@123");
    expect(hash).not.toBe("Senha@123");
    expect(hash.length).toBeGreaterThan(20);
  });

  it("gera hashes diferentes para a mesma senha (salt)", async () => {
    const [a, b] = await Promise.all([hashPassword("Senha@123"), hashPassword("Senha@123")]);
    expect(a).not.toBe(b);
  });

  it("valida a senha correta", async () => {
    const hash = await hashPassword("Senha@123");
    await expect(verifyPassword("Senha@123", hash)).resolves.toBe(true);
  });

  it("rejeita a senha incorreta", async () => {
    const hash = await hashPassword("Senha@123");
    await expect(verifyPassword("errada", hash)).resolves.toBe(false);
  });
});
