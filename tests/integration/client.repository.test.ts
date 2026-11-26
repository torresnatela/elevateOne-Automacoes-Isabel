import { PrismaClientRepository } from "@/server/repositories/client.repository";
import { clientSchema } from "@/server/validators/client.schemas";
import { prisma, resetDatabase } from "../setup/db";

const repo = new PrismaClientRepository(prisma);
const data = (input: Record<string, unknown>) => clientSchema.parse({ name: "Cliente", ...input });

describe("PrismaClientRepository", () => {
  beforeEach(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it("cria, lê e procura por nome ou NIF", async () => {
    const a = await repo.create(data({ name: "Alfa, Lda", nif: "123456789" }));
    await repo.create(data({ name: "Beta SA" }));
    await expect(repo.findById(a.id)).resolves.toMatchObject({ name: "Alfa, Lda" });
    await expect(repo.findByNif("123456789")).resolves.toMatchObject({ id: a.id });
    expect((await repo.list({ query: "alf" })).map((c) => c.name)).toEqual(["Alfa, Lda"]);
    expect((await repo.list({ query: "123456" })).map((c) => c.name)).toEqual(["Alfa, Lda"]);
  });

  it("encontra pelo email ou pelo domínio, só entre os ativos", async () => {
    const a = await repo.create(data({ name: "A", contactEmails: ["faturas@a.pt"] }));
    const b = await repo.create(data({ name: "B", emailDomains: ["b.pt"] }));
    await repo.create(data({ name: "C", contactEmails: ["c@c.pt"] }));
    const found = await repo.findByAddresses(["FATURAS@a.pt", "quem@b.pt"]);
    expect(found.map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
    await repo.setActive(a.id, false);
    expect((await repo.findByAddresses(["faturas@a.pt"])).length).toBe(0);
    expect((await repo.list()).map((c) => c.name)).toEqual(["B", "C"]);
  });

  it("procura por NIF só quando a procura parece um NIF", async () => {
    await repo.create(data({ name: "Loja 2", nif: "500000000" }));
    await repo.create(data({ name: "Outra", nif: "123456789" }));
    expect((await repo.list({ query: "Loja 2" })).map((c) => c.name)).toEqual(["Loja 2"]);
    expect((await repo.list({ query: "PT 123 456" })).map((c) => c.name)).toEqual(["Outra"]);
    // Só pontuação não é um NIF: não pode trazer todos os clientes com NIF.
    expect(await repo.list({ query: "." })).toEqual([]);
    expect(await repo.list({ query: "PT ." })).toEqual([]);
  });

  it("dois clientes ao mesmo tempo com o mesmo email: só um fica", async () => {
    const results = await Promise.allSettled([
      repo.create(data({ name: "A", contactEmails: ["x@x.pt"] })),
      repo.create(data({ name: "B", contactEmails: ["x@x.pt"] })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "CLIENT_EMAIL_TAKEN" },
    });
  });

  it("update devolve null e setActive false para um id que não existe", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    await expect(repo.update(missing, data({}))).resolves.toBeNull();
    await expect(repo.setActive(missing, false)).resolves.toBe(false);
  });
});
