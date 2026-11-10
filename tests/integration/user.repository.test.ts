import { PrismaUserRepository } from "@/server/repositories/user.repository";
import { prisma, resetDatabase } from "../setup/db";

const repo = new PrismaUserRepository(prisma);

describe("PrismaUserRepository", () => {
  beforeEach(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it("cria usuário com e-mail normalizado e papel padrão USER", async () => {
    const user = await repo.create({ name: "Ana", email: "  ANA@Example.com ", passwordHash: "h" });
    expect(user.id).toMatch(/[0-9a-f-]{36}/);
    expect(user.email).toBe("ana@example.com");
    expect(user.role).toBe("USER");
    expect(user.active).toBe(true);
  });

  it("encontra por e-mail (case-insensitive) e por id", async () => {
    const created = await repo.create({ name: "Ana", email: "ana@example.com", passwordHash: "h" });
    await expect(repo.findByEmail("ANA@example.com")).resolves.toMatchObject({ id: created.id });
    await expect(repo.findById(created.id)).resolves.toMatchObject({ email: "ana@example.com" });
  });

  it("retorna null quando não encontra", async () => {
    await expect(repo.findByEmail("x@x.com")).resolves.toBeNull();
    await expect(repo.findById("00000000-0000-0000-0000-000000000000")).resolves.toBeNull();
  });

  it("upsertByEmail não duplica nem sobrescreve usuário existente", async () => {
    const first = await repo.upsertByEmail({ name: "A", email: "a@a.com", passwordHash: "h1", role: "ADMIN" });
    const second = await repo.upsertByEmail({ name: "B", email: "A@a.com", passwordHash: "h2" });
    expect(second.id).toBe(first.id);
    expect(second.passwordHash).toBe("h1");
    expect(await prisma.user.count()).toBe(1);
  });
});
