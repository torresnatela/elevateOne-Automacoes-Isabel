import { PrismaConversationRepository } from "@/server/repositories/conversation.repository";
import { PrismaUserRepository } from "@/server/repositories/user.repository";
import { prisma, resetDatabase } from "../setup/db";

const repo = new PrismaConversationRepository(prisma);

describe("PrismaConversationRepository", () => {
  beforeEach(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it("cria uma conversa de um utilizador e encontra-a por id", async () => {
    const user = await new PrismaUserRepository(prisma).create({
      name: "Ana",
      email: "ana@example.com",
      passwordHash: "h",
    });
    const created = await repo.create({ agentId: "assistente", channel: "WEB", userId: user.id });

    expect(created).toMatchObject({ agentId: "assistente", channel: "WEB", userId: user.id });
    await expect(repo.findById(created.id)).resolves.toMatchObject({ id: created.id });
  });

  it("cria uma conversa de fora do sistema, pelo número", async () => {
    const created = await repo.create({
      agentId: "isabel",
      channel: "WHATSAPP",
      externalId: "351910000000",
    });
    expect(created).toMatchObject({ userId: null, externalId: "351910000000" });
  });

  it("devolve null para um id desconhecido ou mal formado", async () => {
    await expect(repo.findById("00000000-0000-0000-0000-000000000000")).resolves.toBeNull();
    await expect(repo.findById("nao-e-uuid")).resolves.toBeNull();
  });

  it("guarda as mensagens com os blocos intactos e devolve-as por ordem", async () => {
    const c = await repo.create({ agentId: "assistente", channel: "WEB" });
    const blocks = [
      { type: "thinking", thinking: "", signature: "abc" },
      { type: "tool_use", id: "t1", name: "procurar", input: { q: "IVA", n: [1, 2] } },
    ];
    await repo.addMessage(c.id, "USER", [{ type: "text", text: "Olá" }]);
    await repo.addMessage(c.id, "ASSISTANT", blocks);
    await repo.addMessage(c.id, "USER", [{ type: "text", text: "Outra" }]);

    const messages = await repo.listMessages(c.id);
    expect(messages.map((m) => m.role)).toEqual(["USER", "ASSISTANT", "USER"]);
    expect(messages[1].content).toEqual(blocks);
  });

  it("só devolve as mensagens da própria conversa", async () => {
    const a = await repo.create({ agentId: "assistente", channel: "WEB" });
    const b = await repo.create({ agentId: "assistente", channel: "WEB" });
    await repo.addMessage(a.id, "USER", [{ type: "text", text: "da A" }]);
    await repo.addMessage(b.id, "USER", [{ type: "text", text: "da B" }]);

    const messages = await repo.listMessages(a.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toEqual([{ type: "text", text: "da A" }]);
  });
});

describe("PrismaConversationRepository: lista, título e apagar", () => {
  beforeEach(resetDatabase);

  it("lista as conversas de um utilizador com um agente, a mais recente primeiro", async () => {
    const users = new PrismaUserRepository(prisma);
    const ana = await users.create({ name: "Ana", email: "ana@example.com", passwordHash: "h" });
    const rui = await users.create({ name: "Rui", email: "rui@example.com", passwordHash: "h" });
    const first = await repo.create({ agentId: "assistente", channel: "WEB", userId: ana.id });
    const second = await repo.create({ agentId: "assistente", channel: "WEB", userId: ana.id });
    await repo.create({ agentId: "outro", channel: "WEB", userId: ana.id });
    await repo.create({ agentId: "assistente", channel: "WEB", userId: rui.id });
    await repo.setTitle(first.id, "A primeira");
    await repo.addMessage(first.id, "USER", [{ type: "text", text: "mexeu por último" }]);

    const listed = await repo.listByUser("assistente", ana.id);
    expect(listed.map((c) => c.id)).toEqual([first.id, second.id]);
    expect(listed[0].title).toBe("A primeira");
    await expect(repo.listByUser("assistente", "nao-e-uuid")).resolves.toEqual([]);
  });

  it("apagar a conversa apaga as mensagens", async () => {
    const c = await repo.create({ agentId: "assistente", channel: "WEB" });
    await repo.addMessage(c.id, "USER", [{ type: "text", text: "olá" }]);

    await expect(repo.delete(c.id)).resolves.toBe(true);
    await expect(prisma.message.count()).resolves.toBe(0);
    await expect(repo.delete(c.id)).resolves.toBe(false);
  });
});
