import { PrismaGoogleAccountRepository } from "@/server/repositories/google-account.repository";
import { PrismaUserRepository } from "@/server/repositories/user.repository";
import { prisma, resetDatabase } from "../setup/db";

const repo = new PrismaGoogleAccountRepository(prisma);

describe("PrismaGoogleAccountRepository", () => {
  beforeEach(resetDatabase);
  afterAll(() => prisma.$disconnect());

  const newUser = () =>
    new PrismaUserRepository(prisma).create({ name: "Isabel", email: "i@e.pt", passwordHash: "h" });

  it("ligar outra caixa recomeça a leitura das faturas; ligar a mesma não", async () => {
    const user = await newUser();
    const save = (email: string) =>
      repo.save({ userId: user.id, email, refreshTokenEncrypted: "x", scopes: "" });
    const account = await save("a@x.pt");
    await prisma.mailSyncState.create({
      data: { googleAccountId: account.id, syncedUntil: new Date() },
    });
    await prisma.mailSeenMessage.create({
      data: { googleAccountId: account.id, gmailMessageId: "m1" },
    });
    await save("A@x.pt");
    expect(await prisma.mailSyncState.count()).toBe(1);
    await save("b@x.pt");
    expect(await prisma.mailSyncState.count()).toBe(0);
    expect(await prisma.mailSeenMessage.count()).toBe(0);
  });

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
