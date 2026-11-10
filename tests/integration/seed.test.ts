import { PrismaUserRepository } from "@/server/repositories/user.repository";
import { seedDefaultAdmin } from "@/server/services/seed.service";
import { verifyPassword } from "@/server/services/password.service";
import { prisma, resetDatabase } from "../setup/db";

const repo = new PrismaUserRepository(prisma);
const admin = { name: "Administrador", email: "Admin@ElevateOne.local", password: "Admin@123" };

describe("seedDefaultAdmin", () => {
  beforeEach(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it("cria o usuário padrão ADMIN com senha hasheada", async () => {
    const user = await seedDefaultAdmin(repo, admin);
    expect(user).toMatchObject({ email: "admin@elevateone.local", role: "ADMIN", active: true });
    await expect(verifyPassword("Admin@123", user.passwordHash)).resolves.toBe(true);
  });

  it("é idempotente e não altera senha existente", async () => {
    const first = await seedDefaultAdmin(repo, admin);
    const second = await seedDefaultAdmin(repo, { ...admin, password: "OutraSenha@1" });
    expect(second.id).toBe(first.id);
    expect(second.passwordHash).toBe(first.passwordHash);
    expect(await prisma.user.count()).toBe(1);
  });

  it("rejeita configuração inválida", async () => {
    await expect(seedDefaultAdmin(repo, { ...admin, password: "123" })).rejects.toThrow();
    await expect(seedDefaultAdmin(repo, { ...admin, email: "invalido" })).rejects.toThrow();
  });
});
