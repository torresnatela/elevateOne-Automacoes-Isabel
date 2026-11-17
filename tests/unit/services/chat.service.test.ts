import { z } from "zod";
import { AgentRunner } from "@/server/agents/core/runner";
import type { AgentDefinition } from "@/server/agents/core/types";
import { AgentRegistry } from "@/server/agents/registry";
import { ChatService } from "@/server/services/chat.service";
import {
  FakeAgentEventRepository,
  FakeConversationRepository,
} from "../../setup/fake-agent.repositories";
import { calls, FakeLlmClient, says } from "../../setup/fake-llm.client";

const agent: AgentDefinition = {
  id: "assistente",
  name: "Assistente",
  prompt: "p",
  tools: ["consultar"],
  channels: ["WEB"],
  office: { agentId: "assistente", workingText: "A responder" },
};

function setup(script: ConstructorParameters<typeof FakeLlmClient>[0] = []) {
  const registry = new AgentRegistry()
    .registerTool({
      name: "consultar",
      description: "Consulta.",
      schema: z.object({}),
      requiresConfirmation: false,
      execute: async () => "nada",
    })
    .registerAgent(agent);
  const conversations = new FakeConversationRepository();
  const runner = new AgentRunner({
    registry,
    llm: new FakeLlmClient(script),
    conversations,
    events: new FakeAgentEventRepository(),
  });
  return { conversations, chat: new ChatService(registry, runner, conversations, "assistente") };
}

describe("ChatService", () => {
  it("começa uma conversa do utilizador no canal web", async () => {
    const t = setup();
    const c = await t.chat.start("ana");
    expect(c.title).toBe("Nova conversa");
    expect(t.conversations.conversations[0]).toMatchObject({
      agentId: "assistente",
      channel: "WEB",
      userId: "ana",
    });
  });

  it("responde e dá à conversa o título da primeira mensagem", async () => {
    const t = setup([says("É 23 %."), says("Sim.")]);
    const c = await t.chat.start("ana");

    const result = await t.chat.send(c.id, "ana", "  Qual é a taxa\n normal de IVA?  ");
    await t.chat.send(c.id, "ana", "E nas ilhas?");

    expect(result.text).toBe("É 23 %.");
    expect((await t.chat.list("ana"))[0].title).toBe("Qual é a taxa normal de IVA?");
  });

  it("corta um título comprido", async () => {
    const t = setup([says("Ok.")]);
    const c = await t.chat.start("ana");
    await t.chat.send(c.id, "ana", "palavra ".repeat(30));

    const [{ title }] = await t.chat.list("ana");
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith("…")).toBe(true);
  });

  it("mostra só o texto das mensagens, sem os passos das ferramentas", async () => {
    const t = setup([calls({ id: "t1", name: "consultar", input: {} }), says("Encontrei.")]);
    const c = await t.chat.start("ana");
    await t.chat.send(c.id, "ana", "Procura isto");

    const messages = await t.chat.messages(c.id, "ana");
    expect(messages.map((m) => [m.role, m.text])).toEqual([
      ["USER", "Procura isto"],
      ["ASSISTANT", "Encontrei."],
    ]);
  });

  it("lista só as conversas do próprio, a mais recente primeiro", async () => {
    const t = setup([says("a"), says("b")]);
    const first = await t.chat.start("ana");
    const second = await t.chat.start("ana");
    await t.chat.start("rui");
    await t.chat.send(second.id, "ana", "segunda");
    await t.chat.send(first.id, "ana", "primeira");

    expect((await t.chat.list("ana")).map((c) => c.title)).toEqual(["primeira", "segunda"]);
  });

  it("uma conversa de outra pessoa responde como se não existisse", async () => {
    const t = setup([says("x")]);
    const c = await t.chat.start("ana");
    const notFound = { status: 404, code: "CONVERSATION_NOT_FOUND" };

    await expect(t.chat.messages(c.id, "rui")).rejects.toMatchObject(notFound);
    await expect(t.chat.send(c.id, "rui", "olá")).rejects.toMatchObject(notFound);
    await expect(t.chat.remove(c.id, "rui")).rejects.toMatchObject(notFound);
    await expect(t.chat.prepare("nao-existe", "ana")).rejects.toMatchObject(notFound);
    expect(t.conversations.messages).toEqual([]);
  });

  it("apaga a conversa e as mensagens", async () => {
    const t = setup([says("x")]);
    const c = await t.chat.start("ana");
    await t.chat.send(c.id, "ana", "olá");
    await t.chat.remove(c.id, "ana");

    await expect(t.chat.list("ana")).resolves.toEqual([]);
    expect(t.conversations.messages).toEqual([]);
  });
});
