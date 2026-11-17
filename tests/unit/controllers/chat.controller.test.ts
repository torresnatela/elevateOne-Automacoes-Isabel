import { NextRequest } from "next/server";
import { z } from "zod";
import { AgentRunner } from "@/server/agents/core/runner";
import { AgentRegistry } from "@/server/agents/registry";
import { ChatController, type ChatStreamEvent } from "@/server/controllers/chat.controller";
import { SESSION_COOKIE } from "@/server/models/session.model";
import { ChatService } from "@/server/services/chat.service";
import { createSessionToken } from "@/server/services/session.service";
import {
  FakeAgentEventRepository,
  FakeConversationRepository,
} from "../../setup/fake-agent.repositories";
import { calls, FakeLlmClient, says } from "../../setup/fake-llm.client";

async function request(userId: string | null, init: { method?: string; json?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (userId)
    headers.cookie = `${SESSION_COOKIE}=${await createSessionToken({ userId, name: "N", email: "n@n.com", role: "USER" })}`;
  return new NextRequest("http://localhost/api/chat", {
    method: init.method ?? "GET",
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
}

const eventsOf = async (res: Response): Promise<ChatStreamEvent[]> =>
  (await res.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

function setup(script: ConstructorParameters<typeof FakeLlmClient>[0] = []) {
  const registry = new AgentRegistry()
    .registerTool({
      name: "consultar",
      description: "Consulta.",
      statusText: "A consultar…",
      schema: z.object({}),
      requiresConfirmation: false,
      execute: async () => "nada",
    })
    .registerAgent({
      id: "assistente",
      name: "Assistente",
      prompt: "p",
      tools: ["consultar"],
      channels: ["WEB"],
      office: { agentId: "assistente", workingText: "A responder" },
    });
  const conversations = new FakeConversationRepository();
  const runner = new AgentRunner({
    registry,
    llm: new FakeLlmClient(script),
    conversations,
    events: new FakeAgentEventRepository(),
  });
  const chat = new ChatService(registry, runner, conversations, "assistente");
  return { chat, controller: new ChatController(chat) };
}

describe("ChatController", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("401 sem sessão, em todas as rotas", async () => {
    const { controller } = setup();
    expect((await controller.list(await request(null))).status).toBe(401);
    expect((await controller.start(await request(null, { method: "POST" }))).status).toBe(401);
    expect((await controller.messages(await request(null), "x")).status).toBe(401);
    const send = await controller.send(
      await request(null, { method: "POST", json: { text: "olá" } }),
      "x",
    );
    expect(send.status).toBe(401);
  });

  it("cria uma conversa e lista-a", async () => {
    const { controller } = setup();
    const created = await controller.start(await request("ana", { method: "POST" }));
    expect(created.status).toBe(201);

    const listed = await (await controller.list(await request("ana"))).json();
    expect(listed.conversations).toHaveLength(1);
    const others = await (await controller.list(await request("rui"))).json();
    expect(others.conversations).toEqual([]);
  });

  it("responde em streaming: os bocados de texto e, no fim, a resposta inteira", async () => {
    const { controller, chat } = setup([says("É 23 %.")]);
    const c = await chat.start("ana");

    const res = await controller.send(
      await request("ana", { method: "POST", json: { text: "IVA?" } }),
      c.id,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(await eventsOf(res)).toEqual([
      { type: "delta", text: "É " },
      { type: "delta", text: "23 " },
      { type: "delta", text: "%." },
      { type: "done", text: "É 23 %." },
    ]);
  });

  it("avisa quando o agente usa uma ferramenta", async () => {
    const { controller, chat } = setup([
      calls({ id: "t1", name: "consultar", input: {} }),
      says("Pronto."),
    ]);
    const c = await chat.start("ana");
    const res = await controller.send(
      await request("ana", { method: "POST", json: { text: "procura" } }),
      c.id,
    );

    expect(await eventsOf(res)).toEqual([
      { type: "tool", statusText: "A consultar…" },
      { type: "delta", text: "Pronto." },
      { type: "done", text: "Pronto." },
    ]);
  });

  it("400 com mensagem vazia e 404 numa conversa de outra pessoa, antes de responder", async () => {
    const { controller, chat } = setup();
    const c = await chat.start("ana");

    const empty = await controller.send(
      await request("ana", { method: "POST", json: { text: "   " } }),
      c.id,
    );
    expect(empty.status).toBe(400);
    const other = await controller.send(
      await request("rui", { method: "POST", json: { text: "olá" } }),
      c.id,
    );
    expect(other.status).toBe(404);
  });

  it("quando o modelo falha a meio, manda um erro sem pormenores internos", async () => {
    const { controller, chat } = setup([new Error("chave sk-secreta inválida")]);
    const c = await chat.start("ana");
    const res = await controller.send(
      await request("ana", { method: "POST", json: { text: "olá" } }),
      c.id,
    );

    const events = await eventsOf(res);
    expect(events).toEqual([
      { type: "error", message: expect.stringContaining("Tente novamente") },
    ]);
    expect(JSON.stringify(events)).not.toContain("sk-secreta");
  });
});
