import { PrismaConversationRepository } from "@/server/repositories/conversation.repository";
import { PrismaInboundMessageRepository } from "@/server/repositories/inbound-message.repository";
import { PrismaPendingActionRepository } from "@/server/repositories/pending-action.repository";
import { PrismaUserRepository } from "@/server/repositories/user.repository";
import { prisma, resetDatabase } from "../setup/db";

const conversations = new PrismaConversationRepository(prisma);
const pending = new PrismaPendingActionRepository(prisma);
const inbound = new PrismaInboundMessageRepository(prisma);
const users = new PrismaUserRepository(prisma);

describe("WhatsApp e confirmação (Postgres real)", () => {
  beforeEach(resetDatabase);
  afterAll(() => prisma.$disconnect());

  const action = (conversationId: string, runId = "run-1") => ({
    conversationId,
    runId,
    toolName: "agenda_criar",
    input: { titulo: "Reunião", convidados: ["joao@cliente.pt"] },
    description: "Marcar «Reunião»",
    expiresAt: new Date(Date.now() + 60_000),
  });

  it("uma mensagem só se regista uma vez", async () => {
    await expect(inbound.claim("MSG1")).resolves.toBe(true);
    await expect(inbound.claim("MSG1")).resolves.toBe(false);
    await expect(inbound.claim("MSG2")).resolves.toBe(true);
  });

  it("guarda a ação pendente com o input intacto", async () => {
    const c = await conversations.create({ agentId: "a", channel: "WHATSAPP", externalId: "351" });
    const created = await pending.create(action(c.id));

    await expect(pending.findById(created.id)).resolves.toMatchObject({
      status: "PENDING",
      runId: "run-1",
      input: { titulo: "Reunião", convidados: ["joao@cliente.pt"] },
      description: "Marcar «Reunião»",
    });
    await expect(pending.findById("nao-e-uuid")).resolves.toBeNull();
  });

  it("só o primeiro a resolver leva a ação", async () => {
    const c = await conversations.create({ agentId: "a", channel: "WHATSAPP" });
    const created = await pending.create(action(c.id));

    const results = await Promise.all([
      pending.resolve(created.id, "CONFIRMED"),
      pending.resolve(created.id, "CONFIRMED"),
    ]);
    expect(results.sort()).toEqual([false, true]);
    await expect(pending.resolve(created.id, "CANCELLED")).resolves.toBe(false);
    await expect(pending.findById(created.id)).resolves.toMatchObject({ status: "CONFIRMED" });
  });

  it("desiste de todas as pendentes de uma conversa, sem tocar nas outras", async () => {
    const a = await conversations.create({ agentId: "a", channel: "WHATSAPP" });
    const b = await conversations.create({ agentId: "a", channel: "WHATSAPP" });
    const mine = await pending.create(action(a.id));
    const done = await pending.create(action(a.id));
    await pending.resolve(done.id, "CONFIRMED");
    const other = await pending.create(action(b.id));

    await pending.cancelAllOf(a.id);

    await expect(pending.findById(mine.id)).resolves.toMatchObject({ status: "CANCELLED" });
    await expect(pending.findById(done.id)).resolves.toMatchObject({ status: "CONFIRMED" });
    await expect(pending.findById(other.id)).resolves.toMatchObject({ status: "PENDING" });
  });

  it("encontra a conversa mais recente de um número com um agente", async () => {
    const old = await conversations.create({
      agentId: "a",
      channel: "WHATSAPP",
      externalId: "351",
    });
    const recent = await conversations.create({
      agentId: "a",
      channel: "WHATSAPP",
      externalId: "351",
    });
    await conversations.create({ agentId: "a", channel: "WHATSAPP", externalId: "999" });
    await conversations.addMessage(recent.id, "USER", [{ type: "text", text: "olá" }]);

    await expect(conversations.findLatestExternal("a", "WHATSAPP", "351")).resolves.toMatchObject({
      id: recent.id,
    });
    await expect(conversations.findLatestExternal("a", "WEB", "351")).resolves.toBeNull();
    expect(old.id).not.toBe(recent.id);
  });

  it("guarda o número de um utilizador, único, e encontra-o por ele", async () => {
    const isabel = await users.create({ name: "Isabel", email: "i@e.pt", passwordHash: "h" });
    const rui = await users.create({ name: "Rui", email: "r@e.pt", passwordHash: "h" });

    await expect(users.setPhone(isabel.id, "351912345678")).resolves.toBe(true);
    await expect(users.findByPhone("351912345678")).resolves.toMatchObject({ id: isabel.id });
    await expect(users.setPhone(rui.id, "351912345678")).rejects.toThrow();
    await expect(users.setPhone("00000000-0000-0000-0000-000000000000", "351")).resolves.toBe(
      false,
    );
    expect((await users.list()).map((u) => u.name)).toEqual(["Isabel", "Rui"]);
  });
});
