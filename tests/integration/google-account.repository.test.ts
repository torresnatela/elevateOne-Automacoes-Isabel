import { PrismaGoogleAccountRepository } from "@/server/repositories/google-account.repository";
import { PrismaUserRepository } from "@/server/repositories/user.repository";
import { prisma, resetDatabase } from "../setup/db";

const repo = new PrismaGoogleAccountRepository(prisma);

describe("PrismaGoogleAccountRepository", () => {
  beforeEach(resetDatabase);
  afterAll(() => prisma.$disconnect());

  const newUser = () =>
    new PrismaUserRepository(prisma).create({ name: "Isabel", email: "i@e.pt", passwordHash: "h" });

  it("guarda uma conta por utilizador; ligar de novo substitui a anterior", async () => {
    const user = await newUser();
    await repo.save({
      userId: user.id,
      email: "a@gmail.com",
      refreshTokenEncrypted: "v1.a",
      scopes: "x",
    });
    await repo.save({
      userId: user.id,
      email: "b@gmail.com",
      refreshTokenEncrypted: "v1.b",
      scopes: "x y",
    });

    await expect(repo.findByUserId(user.id)).resolves.toMatchObject({
      email: "b@gmail.com",
      refreshTokenEncrypted: "v1.b",
      scopes: "x y",
    });
    await expect(prisma.googleAccount.count()).resolves.toBe(1);
  });

  it("apaga, e não encontra o que não existe", async () => {
    const user = await newUser();
    await repo.save({
      userId: user.id,
      email: "a@gmail.com",
      refreshTokenEncrypted: "v1.a",
      scopes: "",
    });
    await repo.delete(user.id);
    await repo.delete(user.id);

    await expect(repo.findByUserId(user.id)).resolves.toBeNull();
    await expect(repo.findByUserId("nao-e-uuid")).resolves.toBeNull();
  });

  it("apagar o utilizador apaga a conta ligada", async () => {
    const user = await newUser();
    await repo.save({
      userId: user.id,
      email: "a@gmail.com",
      refreshTokenEncrypted: "v1.a",
      scopes: "",
    });
    await prisma.user.delete({ where: { id: user.id } });
    await expect(prisma.googleAccount.count()).resolves.toBe(0);
  });
});
