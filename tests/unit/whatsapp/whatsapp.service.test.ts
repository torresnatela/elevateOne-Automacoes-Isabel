import { z } from "zod";
import { AgentRunner } from "@/server/agents/core/runner";
import { AgentRegistry } from "@/server/agents/registry";
import { REPLIES, WhatsappService } from "@/server/channels/whatsapp/whatsapp.service";
import {
  FakeAgentEventRepository,
  FakeConversationRepository,
  FakePendingActionRepository,
} from "../../setup/fake-agent.repositories";
import { calls, FakeLlmClient, says } from "../../setup/fake-llm.client";
import { FakeUserRepository } from "../../setup/fake-user.repository";
import {
  FakeInboundMessageRepository,
  FakeMessenger,
  FakeTranscriber,
  webhook,
} from "../../setup/fake-whatsapp";

const PHONE = "351912345678";

async function setup(script: ConstructorParameters<typeof FakeLlmClient>[0] = []) {
  const marked: unknown[] = [];
  const registry = new AgentRegistry()
    .registerTool({
      name: "marcar",
      description: "Marca.",
      schema: z.object({ quando: z.string() }),
      requiresConfirmation: true,
      describe: (_ctx, input: { quando: string }) => `Marcar uma reunião ${input.quando}`,
      execute: async (ctx, input) => {
        marked.push({ userId: ctx.userId, channel: ctx.channel, input });
        return "marcada";
      },
    })
    .registerAgent({
      id: "assistente-isabel",
      name: "Assistente",
      prompt: "p",
      tools: ["marcar"],
      channels: ["WHATSAPP"],
      office: { agentId: "assistente-isabel", workingText: "A tratar" },
    });
  const users = new FakeUserRepository();
  const isabel = await users.create({ name: "Isabel", email: "i@e.pt", passwordHash: "h" });
  await users.setPhone(isabel.id, PHONE);
  const clock = { now: new Date("2026-11-12T10:00:00Z") };
  const conversations = new FakeConversationRepository(() => clock.now);
  const pending = new FakePendingActionRepository();
  const llm = new FakeLlmClient(script);
  const runner = new AgentRunner({
    registry,
    llm,
    conversations,
    events: new FakeAgentEventRepository(),
    pendingActions: pending,
    now: () => clock.now,
  });
  const messenger = new FakeMessenger();
  const transcriber = new FakeTranscriber();
  const logs: string[] = [];
  const service = new WhatsappService({
    users,
    inbound: new FakeInboundMessageRepository(),
    conversations,
    runner,
    messenger,
    transcriber,
    agentId: "assistente-isabel",
    now: () => clock.now,
    log: (m) => logs.push(m),
  });
  return {
    service,
    users,
    isabel,
    conversations,
    pending,
    llm,
    clock,
    messenger,
    transcriber,
    marked,
    logs,
  };
}

const text = (body: string, id = "MSG1") => webhook({ conversation: body }, { id });

describe("WhatsappService", () => {
  it("responde a uma mensagem de texto de um número autorizado", async () => {
    const t = await setup([says("Olá, Isabel.")]);

    await expect(t.service.handle(text("Olá"))).resolves.toBe("replied");

    expect(t.messenger.sent).toEqual([{ phone: PHONE, text: "Olá, Isabel." }]);
    expect(t.conversations.conversations[0]).toMatchObject({
      agentId: "assistente-isabel",
      channel: "WHATSAPP",
      userId: t.isabel.id,
      externalId: PHONE,
    });
  });

  it("diz ao agente que dia e que horas são", async () => {
    const t = await setup([says("Ok.")]);
    await t.service.handle(text("marca para amanhã"));

    const [context, message] = t.llm.requests[0].messages[0].content;
    expect(context.text).toMatch(/Agora: quinta-feira, 12 de novembro de 2026.*10:00/);
    expect(message.text).toBe("marca para amanhã");
  });

  it("não responde a um número desconhecido nem a um utilizador inativo", async () => {
    const t = await setup();
    const stranger = webhook({ conversation: "Olá" }, { remoteJid: "351999999999@s.whatsapp.net" });
    await expect(t.service.handle(stranger)).resolves.toBe("unauthorized");

    t.users.users[0].active = false;
    await expect(t.service.handle(text("Olá", "MSG2"))).resolves.toBe("unauthorized");

    expect(t.messenger.sent).toEqual([]);
    expect(t.llm.requests).toEqual([]);
    expect(t.logs[0]).toContain("9999");
    expect(t.logs[0]).not.toContain("351999999999");
  });

  it("não trata a mesma mensagem duas vezes", async () => {
    const t = await setup([says("Olá.")]);
    await t.service.handle(text("Olá"));
    await expect(t.service.handle(text("Olá"))).resolves.toBe("duplicate");
    expect(t.messenger.sent).toHaveLength(1);
  });

  it("ignora o que não é uma mensagem para nós", async () => {
    const t = await setup();
    await expect(t.service.handle(webhook({ conversation: "x" }, { fromMe: true }))).resolves.toBe(
      "ignored",
    );
    await expect(t.service.handle({ event: "connection.update" })).resolves.toBe("ignored");
  });

  it("passa um áudio a texto: usa o que vem no webhook ou vai buscá-lo", async () => {
    const t = await setup([says("Vou ver."), says("Outra vez.")]);
    const inline = webhook(
      {
        audioMessage: { mimetype: "audio/ogg" },
        base64: Buffer.from("áudio do webhook").toString("base64"),
      },
      { id: "A1" },
    );
    await t.service.handle(inline);
    await t.service.handle(webhook({ audioMessage: {} }, { id: "A2" }));

    expect(t.transcriber.heard).toEqual(["áudio do webhook", "áudio descarregado"]);
    expect(t.messenger.downloads).toHaveLength(1);
    const [context, message] = t.llm.requests[0].messages[0].content;
    expect(message.text).toBe("marca uma reunião com o João amanhã às 15h");
    expect(context.text).toContain("transcrita de um áudio");
  });

  it("pede para repetir quando o áudio não se percebe", async () => {
    const t = await setup();
    t.transcriber.says = "";
    await t.service.handle(webhook({ audioMessage: {} }));

    expect(t.messenger.sent).toEqual([{ phone: PHONE, text: REPLIES.emptyAudio }]);
    expect(t.llm.requests).toEqual([]);
  });

  it("diz que só lê texto e voz quando recebe outra coisa", async () => {
    const t = await setup();
    await t.service.handle(webhook({ imageMessage: {} }));
    expect(t.messenger.sent).toEqual([{ phone: PHONE, text: REPLIES.unsupported }]);
  });

  it("do pedido ao sim: mostra o resumo, espera, e só então marca", async () => {
    const t = await setup([
      calls({ id: "p1", name: "marcar", input: { quando: "amanhã às 15h" } }),
      says("Preciso que confirme."),
    ]);
    await t.service.handle(text("marca uma reunião amanhã às 15h", "M1"));

    expect(t.marked).toEqual([]);
    expect(t.messenger.sent[0].text).toContain("Para confirmar:\nMarcar uma reunião amanhã às 15h");
    expect(t.messenger.sent[0].text).toContain("Responda *sim*");

    const id = t.pending.actions[0].id;
    t.llm.script.push(calls({ id: "c1", name: "confirmar_acao", input: { id } }), says("Marcado."));
    await t.service.handle(text("sim", "M2"));

    expect(t.marked).toEqual([
      { userId: t.isabel.id, channel: "WHATSAPP", input: { quando: "amanhã às 15h" } },
    ]);
    expect(t.messenger.sent[1]).toEqual({ phone: PHONE, text: "Marcado." });
    expect(t.conversations.conversations).toHaveLength(1);
  });

  it("continua a conversa em curso, e começa outra depois de horas sem mensagens", async () => {
    const t = await setup([says("1"), says("2"), says("3")]);
    await t.service.handle(text("a", "M1"));
    t.clock.now = new Date("2026-11-12T15:00:00Z");
    await t.service.handle(text("b", "M2"));
    expect(t.conversations.conversations).toHaveLength(1);

    t.clock.now = new Date("2026-11-12T22:00:00Z");
    await t.service.handle(text("c", "M3"));
    expect(t.conversations.conversations).toHaveLength(2);
    expect(t.llm.requests[2].messages).toHaveLength(1);
  });

  it("trata as mensagens de um número uma de cada vez, pela ordem", async () => {
    const t = await setup([says("primeira"), says("segunda")]);
    await Promise.all([t.service.handle(text("a", "M1")), t.service.handle(text("b", "M2"))]);

    expect(t.messenger.sent.map((m) => m.text)).toEqual(["primeira", "segunda"]);
    expect(t.conversations.conversations).toHaveLength(1);
    expect(t.llm.requests[1].messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("quando o agente falha, avisa quem pediu sem pormenores internos", async () => {
    const t = await setup([new Error("chave sk-secreta inválida")]);

    await expect(t.service.handle(text("Olá"))).resolves.toBe("failed");

    expect(t.messenger.sent).toEqual([{ phone: PHONE, text: REPLIES.failed }]);
    expect(t.logs.join()).toContain("sk-secreta");
  });

  it("se nem o aviso de falha sair, não rebenta", async () => {
    const t = await setup([says("Olá.")]);
    t.messenger.failSending = true;
    await expect(t.service.handle(text("Olá"))).resolves.toBe("failed");
  });
});
