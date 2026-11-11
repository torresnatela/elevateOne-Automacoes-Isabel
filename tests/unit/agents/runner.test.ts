import { z } from "zod";
import { AgentRunner } from "@/server/agents/core/runner";
import type { AgentDefinition, ToolContext, ToolDefinition } from "@/server/agents/core/types";
import { AgentRegistry } from "@/server/agents/registry";
import {
  FakeAgentEventRepository,
  FakeConversationRepository,
  FakePendingActionRepository,
} from "../../setup/fake-agent.repositories";
import { calls, FakeLlmClient, says } from "../../setup/fake-llm.client";

const agent: AgentDefinition = {
  id: "assistente",
  name: "Assistente",
  prompt: "És o assistente do escritório.",
  tools: ["procurar", "marcar", "consultar"],
  channels: ["WEB"],
  office: { agentId: "eva", workingText: "A responder a uma dúvida" },
};

function setup(
  script: ConstructorParameters<typeof FakeLlmClient>[0],
  done?: AgentDefinition["office"]["done"],
) {
  const executed: Array<{ ctx: ToolContext; input: unknown }> = [];
  const procurar: ToolDefinition<{ q: string }> = {
    name: "procurar",
    description: "Procura na base de conhecimento.",
    statusText: "A procurar…",
    schema: z.object({ q: z.string().min(1) }),
    requiresConfirmation: false,
    execute: async (ctx, input) => {
      executed.push({ ctx, input });
      if (input.q === "explode") throw new Error("a base caiu");
      return { resultados: [`sobre ${input.q}`] };
    },
    office: { type: "apoio", tool: "claude", minutes: 3, doneText: "Esclareceu uma dúvida" },
  };
  const marcar: ToolDefinition<{ quando: string }> = {
    name: "marcar",
    description: "Marca uma reunião.",
    schema: z.object({ quando: z.string() }),
    requiresConfirmation: true,
    describe: (_ctx, input) => `Marcar uma reunião ${input.quando}`,
    execute: async (ctx, input) => {
      executed.push({ ctx, input });
      if (input.quando === "nunca") throw new Error("a agenda recusou");
      return "marcada";
    },
    office: { type: "marcacao", tool: "calendar", minutes: 5, doneText: "Marcou uma reunião" },
  };
  const consultar: ToolDefinition<Record<string, never>> = {
    name: "consultar",
    description: "Consulta sem rasto na atividade.",
    schema: z.object({}),
    requiresConfirmation: false,
    execute: async () => "nada",
  };
  const registry = new AgentRegistry()
    .registerTool(procurar)
    .registerTool(marcar)
    .registerTool(consultar)
    .registerAgent({ ...agent, office: { ...agent.office, done } });
  const conversations = new FakeConversationRepository();
  const events = new FakeAgentEventRepository();
  const llm = new FakeLlmClient(script);
  const pending = new FakePendingActionRepository();
  const clock = { now: new Date("2026-11-12T10:00:00Z") };
  const deps = { registry, llm, conversations, events };
  // Sem ações pendentes: como um canal que não sabe confirmar.
  const runner = new AgentRunner(deps);
  const confirming = new AgentRunner({ ...deps, pendingActions: pending, now: () => clock.now });
  const start = () => conversations.create({ agentId: "assistente", channel: "WEB", userId: "u1" });
  return {
    runner,
    confirming,
    pending,
    clock,
    registry,
    llm,
    conversations,
    events,
    executed,
    start,
  };
}

describe("AgentRunner", () => {
  it("responde a uma mensagem e guarda a conversa", async () => {
    const t = setup([says("Olá, Isabel.")]);
    const c = await t.start();

    const result = await t.runner.run({ conversationId: c.id, text: "Olá" });

    expect(result.text).toBe("Olá, Isabel.");
    expect(t.llm.requests[0].system).toBe("És o assistente do escritório.");
    expect(t.llm.requests[0].messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Olá" }] },
    ]);
    expect(t.llm.requests[0].tools.map((x) => x.name)).toEqual(["procurar", "marcar", "consultar"]);
    expect(t.llm.requests[0].tools[0].inputSchema).toMatchObject({
      type: "object",
      properties: { q: { type: "string" } },
      required: ["q"],
    });
    expect(t.conversations.messages.map((m) => m.role)).toEqual(["USER", "ASSISTANT"]);
  });

  it("usa as instruções que o admin escreveu, quando há", async () => {
    const t = setup([says("Olá.")]);
    const runner = new AgentRunner({
      registry: t.registry,
      llm: t.llm,
      conversations: t.conversations,
      events: t.events,
      prompts: { promptOf: async (id) => `instruções novas de ${id}` },
    });
    const c = await t.start();
    await runner.run({ conversationId: c.id, text: "Olá" });

    expect(t.llm.requests[0].system).toBe("instruções novas de assistente");
  });

  it("envia o histórico da conversa nas mensagens seguintes", async () => {
    const t = setup([says("Um."), says("Dois.")]);
    const c = await t.start();
    await t.runner.run({ conversationId: c.id, text: "primeira" });
    await t.runner.run({ conversationId: c.id, text: "segunda" });

    expect(t.llm.requests[1].messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("corre a ferramenta pedida e devolve o resultado ao modelo", async () => {
    const t = setup([calls({ id: "t1", name: "procurar", input: { q: "IVA" } }), says("É 23 %.")]);
    const c = await t.start();

    const result = await t.runner.run({ conversationId: c.id, text: "Qual é o IVA?" });

    expect(result.text).toBe("É 23 %.");
    expect(t.executed).toEqual([
      {
        ctx: { agentId: "assistente", conversationId: c.id, channel: "WEB", userId: "u1" },
        input: { q: "IVA" },
      },
    ]);
    expect(t.llm.requests[1].messages.at(-1)).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: JSON.stringify({ resultados: ["sobre IVA"] }),
        },
      ],
    });
  });

  it("devolve todos os resultados de ferramentas numa só mensagem", async () => {
    const t = setup([
      calls(
        { id: "a", name: "procurar", input: { q: "IRS" } },
        { id: "b", name: "procurar", input: { q: "IRC" } },
      ),
      says("Feito."),
    ]);
    const c = await t.start();
    await t.runner.run({ conversationId: c.id, text: "IRS e IRC" });

    const last = t.llm.requests[1].messages.at(-1)!;
    expect(last.content.map((b) => b.tool_use_id)).toEqual(["a", "b"]);
  });

  it("guarda e reenvia sem mexer os blocos que não conhece", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "abc" };
    const t = setup([
      {
        content: [thinking, { type: "tool_use", id: "t1", name: "consultar", input: {} }],
        stopReason: "tool_use",
      },
      says("Pronto."),
    ]);
    const c = await t.start();
    await t.runner.run({ conversationId: c.id, text: "consulta" });

    expect(t.llm.requests[1].messages[1].content[0]).toEqual(thinking);
  });

  it("diz ao modelo quando o input da ferramenta é inválido, sem a correr", async () => {
    const t = setup([calls({ id: "t1", name: "procurar", input: { q: "" } }), says("Desculpa.")]);
    const c = await t.start();
    await t.runner.run({ conversationId: c.id, text: "?" });

    expect(t.executed).toEqual([]);
    expect(t.llm.requests[1].messages.at(-1)!.content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "t1",
      is_error: true,
    });
  });

  it("recusa uma ferramenta que o agente não tem", async () => {
    const t = setup([calls({ id: "t1", name: "apagar_tudo", input: {} }), says("Não posso.")]);
    const c = await t.start();
    await t.runner.run({ conversationId: c.id, text: "apaga" });

    expect(t.llm.requests[1].messages.at(-1)!.content[0]).toMatchObject({ is_error: true });
  });

  it("num canal sem confirmação, uma ferramenta que a exige nunca corre", async () => {
    const t = setup([
      calls({ id: "t1", name: "marcar", input: { quando: "amanhã" } }),
      says("Preciso de confirmação."),
    ]);
    const c = await t.start();
    await t.runner.run({ conversationId: c.id, text: "marca" });

    expect(t.executed).toEqual([]);
    expect(t.llm.requests[1].messages.at(-1)!.content[0]).toMatchObject({ is_error: true });
  });

  it("quando a ferramenta falha, avisa o modelo e pede ajuda no escritório", async () => {
    const t = setup([
      calls({ id: "t1", name: "procurar", input: { q: "explode" } }),
      says("Não consegui."),
    ]);
    const c = await t.start();
    const result = await t.runner.run({ conversationId: c.id, text: "?" });

    expect(result.text).toBe("Não consegui.");
    expect(t.llm.requests[1].messages.at(-1)!.content[0]).toMatchObject({ is_error: true });
    expect(t.events.events.map((e) => [e.state, e.type])).toEqual([
      ["WORKING", null],
      ["NEEDS_HELP", "alerta"],
      ["IDLE", null],
    ]);
  });

  it("conta no escritório o que fez: começa, faz a tarefa, fica livre", async () => {
    const t = setup([
      calls(
        { id: "t1", name: "procurar", input: { q: "IVA" } },
        { id: "t2", name: "consultar", input: {} },
      ),
      says("É 23 %."),
    ]);
    const c = await t.start();
    await t.runner.run({ conversationId: c.id, text: "IVA?" });

    expect(t.events.events).toMatchObject([
      { agent: "eva", state: "WORKING", type: null, text: "A responder a uma dúvida", minutes: 0 },
      {
        agent: "eva",
        state: "WORKING",
        type: "apoio",
        text: "Esclareceu uma dúvida",
        tool: "claude",
        minutes: 3,
      },
      { agent: "eva", state: "IDLE", type: null },
    ]);
  });

  it("entrega o texto aos bocados e avisa quando usa uma ferramenta", async () => {
    const t = setup([calls({ id: "t1", name: "procurar", input: { q: "IVA" } }), says("É 23 %.")]);
    const c = await t.start();
    const seen: string[] = [];

    await t.runner.run({
      conversationId: c.id,
      text: "IVA?",
      onText: (delta) => seen.push(delta),
      onTool: (tool) => seen.push(`[${tool.name}: ${tool.statusText}]`),
    });

    expect(seen).toEqual(["[procurar: A procurar…]", "É ", "23 ", "%."]);
  });

  it("conta a resposta como tarefa feita, quando o agente a define", async () => {
    const t = setup([says("Olá.")], {
      type: "apoio",
      tool: "claude",
      minutes: 3,
      doneText: "Esclareceu uma dúvida",
    });
    const c = await t.start();
    await t.runner.run({ conversationId: c.id, text: "Olá" });

    expect(t.events.events.map((e) => [e.state, e.type, e.minutes])).toEqual([
      ["WORKING", null, 0],
      ["WORKING", "apoio", 3],
      ["IDLE", null, 0],
    ]);
  });

  it("pede ajuda no escritório e propaga o erro quando o modelo falha", async () => {
    const t = setup([new Error("sem rede")]);
    const c = await t.start();

    await expect(t.runner.run({ conversationId: c.id, text: "Olá" })).rejects.toThrow("sem rede");
    expect(t.events.events.at(-1)).toMatchObject({ state: "NEEDS_HELP", type: "alerta" });
    expect(t.conversations.messages.map((m) => m.role)).toEqual(["USER"]);
  });

  it("para ao fim de um limite de voltas", async () => {
    const loop = () => calls({ id: "t", name: "consultar", input: {} });
    const t = setup(Array.from({ length: 20 }, () => loop));
    const c = await t.start();

    await expect(t.runner.run({ conversationId: c.id, text: "?" })).rejects.toMatchObject({
      code: "AGENT_LOOP_LIMIT",
    });
    expect(t.llm.requests).toHaveLength(8);
    expect(t.events.events.at(-1)).toMatchObject({ state: "NEEDS_HELP" });
  });

  it("responde com uma mensagem própria quando o modelo recusa", async () => {
    const t = setup([{ content: [], stopReason: "refusal" }]);
    const c = await t.start();
    const result = await t.runner.run({ conversationId: c.id, text: "?" });

    expect(result.text).toMatch(/não consigo ajudar/i);
    expect(t.conversations.messages.at(-1)!.content).toEqual([{ type: "text", text: result.text }]);
  });

  it("responde 404 a uma conversa que não existe", async () => {
    const t = setup([]);
    await expect(t.runner.run({ conversationId: "nao-existe", text: "?" })).rejects.toMatchObject({
      status: 404,
      code: "CONVERSATION_NOT_FOUND",
    });
  });

  describe("confirmação antes de escrever", () => {
    const propose = (quando = "amanhã às 15h") =>
      calls({ id: "p1", name: "marcar", input: { quando } });
    /** O id da ação, tal como o modelo o recebeu no resultado da ferramenta. */
    const actionIdSeenBy = (request: { messages: { content: Array<Record<string, unknown>> }[] }) =>
      JSON.parse(request.messages.at(-1)!.content[0].content as string).acao_id as string;

    it("não corre a ferramenta: guarda a ação e junta o resumo exato à resposta", async () => {
      const t = setup([propose(), says("Preciso que confirme.")]);
      const c = await t.start();

      const result = await t.confirming.run({ conversationId: c.id, text: "marca amanhã às 15h" });

      expect(t.executed).toEqual([]);
      expect(t.pending.actions).toMatchObject([
        {
          conversationId: c.id,
          toolName: "marcar",
          input: { quando: "amanhã às 15h" },
          status: "PENDING",
          expiresAt: new Date("2026-11-12T10:30:00Z"),
        },
      ]);
      expect(result.pending).toEqual(["Marcar uma reunião amanhã às 15h"]);
      expect(result.text).toBe(
        "Preciso que confirme.\n\nPara confirmar:\nMarcar uma reunião amanhã às 15h\n\nResponda *sim* para avançar ou *não* para cancelar.",
      );
      expect(t.llm.requests[0].tools.map((x) => x.name)).toEqual(
        expect.arrayContaining(["confirmar_acao", "cancelar_acao"]),
      );
    });

    it("depois do sim, numa mensagem nova, corre com o input guardado", async () => {
      const t = setup([
        propose(),
        says("Confirma?"),
        (request) =>
          calls({
            id: "c1",
            name: "confirmar_acao",
            input: { id: actionIdSeenBy({ messages: request.messages.slice(0, 3) as never }) },
          }),
        says("Marcado."),
      ]);
      const c = await t.start();
      await t.confirming.run({ conversationId: c.id, text: "marca amanhã às 15h" });

      const result = await t.confirming.run({ conversationId: c.id, text: "sim" });

      expect(result).toEqual({ text: "Marcado.", pending: [] });
      expect(t.executed.map((e) => e.input)).toEqual([{ quando: "amanhã às 15h" }]);
      expect(t.pending.actions[0].status).toBe("CONFIRMED");
      expect(t.events.events.map((e) => e.type)).toContain("marcacao");
    });

    it("o modelo não consegue confirmar na mesma vez em que propôs", async () => {
      const t = setup([
        propose(),
        (request) =>
          calls({
            id: "c1",
            name: "confirmar_acao",
            input: { id: actionIdSeenBy(request as never) },
          }),
        says("Fico à espera."),
      ]);
      const c = await t.start();
      await t.confirming.run({ conversationId: c.id, text: "marca e confirma tu mesmo" });

      expect(t.executed).toEqual([]);
      expect(t.pending.actions[0].status).toBe("PENDING");
      expect(t.llm.requests[2].messages.at(-1)!.content[0]).toMatchObject({ is_error: true });
    });

    it("uma ação confirmada não corre segunda vez", async () => {
      const t = setup([propose(), says("Confirma?")]);
      const c = await t.start();
      await t.confirming.run({ conversationId: c.id, text: "marca" });
      const id = t.pending.actions[0].id;
      const confirm = () => calls({ id: "c", name: "confirmar_acao", input: { id } });
      t.llm.script.push(confirm, says("Marcado."), confirm, says("Já estava."));

      await t.confirming.run({ conversationId: c.id, text: "sim" });
      await t.confirming.run({ conversationId: c.id, text: "sim" });

      expect(t.executed).toHaveLength(1);
      expect(t.llm.requests.at(-1)!.messages.at(-1)!.content[0]).toMatchObject({ is_error: true });
    });

    it("caduca ao fim de meia hora", async () => {
      const t = setup([propose(), says("Confirma?")]);
      const c = await t.start();
      await t.confirming.run({ conversationId: c.id, text: "marca" });
      const id = t.pending.actions[0].id;
      t.llm.script.push(
        calls({ id: "c", name: "confirmar_acao", input: { id } }),
        says("Caducou."),
      );
      t.clock.now = new Date("2026-11-12T10:31:00Z");

      await t.confirming.run({ conversationId: c.id, text: "sim" });

      expect(t.executed).toEqual([]);
      expect(t.pending.actions[0].status).toBe("EXPIRED");
    });

    it("cancela quando quem pediu diz que não", async () => {
      const t = setup([propose(), says("Confirma?")]);
      const c = await t.start();
      await t.confirming.run({ conversationId: c.id, text: "marca" });
      const id = t.pending.actions[0].id;
      t.llm.script.push(
        calls({ id: "c", name: "cancelar_acao", input: { id } }),
        says("Cancelado."),
      );

      await t.confirming.run({ conversationId: c.id, text: "não" });

      expect(t.executed).toEqual([]);
      expect(t.pending.actions[0].status).toBe("CANCELLED");
    });

    it("uma proposta nova substitui a que ficou sem resposta", async () => {
      const t = setup([propose("amanhã"), says("Confirma?"), propose("sexta"), says("E agora?")]);
      const c = await t.start();
      await t.confirming.run({ conversationId: c.id, text: "marca amanhã" });
      await t.confirming.run({ conversationId: c.id, text: "afinal sexta" });

      expect(t.pending.actions.map((a) => [a.input, a.status])).toEqual([
        [{ quando: "amanhã" }, "CANCELLED"],
        [{ quando: "sexta" }, "PENDING"],
      ]);
    });

    it("não confirma uma ação de outra conversa nem um id inventado", async () => {
      const t = setup([propose(), says("Confirma?")]);
      const mine = await t.start();
      const other = await t.start();
      await t.confirming.run({ conversationId: mine.id, text: "marca" });
      const id = t.pending.actions[0].id;
      t.llm.script.push(
        calls(
          { id: "a", name: "confirmar_acao", input: { id } },
          { id: "b", name: "confirmar_acao", input: { id: "inventado" } },
          { id: "c", name: "confirmar_acao", input: {} },
        ),
        says("Não há nada."),
      );

      await t.confirming.run({ conversationId: other.id, text: "sim" });

      expect(t.executed).toEqual([]);
      expect(t.pending.actions[0].status).toBe("PENDING");
    });

    it("se a ação confirmada falhar ao correr, fica como falhada e o modelo sabe", async () => {
      const t = setup([propose("nunca"), says("Confirma?")]);
      const c = await t.start();
      await t.confirming.run({ conversationId: c.id, text: "marca" });
      const id = t.pending.actions[0].id;
      t.llm.script.push(calls({ id: "c", name: "confirmar_acao", input: { id } }), says("Falhou."));

      await t.confirming.run({ conversationId: c.id, text: "sim" });

      expect(t.pending.actions[0].status).toBe("FAILED");
      expect(t.llm.requests.at(-1)!.messages.at(-1)!.content[0]).toMatchObject({
        is_error: true,
        content: "a agenda recusou",
      });
    });

    it("junta o contexto da vez à mensagem de quem pediu", async () => {
      const t = setup([says("Olá.")]);
      const c = await t.start();
      await t.confirming.run({
        conversationId: c.id,
        text: "olá",
        context: "[Agora: quinta, 10:00]",
      });

      expect(t.llm.requests[0].messages[0].content).toEqual([
        { type: "text", text: "[Agora: quinta, 10:00]" },
        { type: "text", text: "olá" },
      ]);
    });
  });
});
