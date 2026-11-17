import { NextRequest } from "next/server";
import { AgentRegistry } from "@/server/agents/registry";
import { OfficeController } from "@/server/controllers/office.controller";
import { OfficeService } from "@/server/services/office.service";
import { FakeAgentEventRepository } from "../../setup/fake-agent.repositories";

const get = (query = "", token?: string) =>
  new NextRequest(`http://localhost/api/office/eventos${query}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

async function setup(token: string | undefined = "token-1") {
  const registry = new AgentRegistry().registerAgent({
    id: "assistente-isabel",
    name: "Assistente da Isabel",
    prompt: "p",
    tools: [],
    channels: ["WHATSAPP"],
    office: { agentId: "isabel", role: "Trata da agenda", workingText: "A tratar" },
  });
  const events = new FakeAgentEventRepository();
  await events.create({ agent: "isabel", state: "WORKING", text: "A tratar de um pedido" });
  await events.create({
    agent: "isabel",
    state: "WORKING",
    type: "marcacao",
    text: "Marcou uma reunião",
    tool: "calendar",
    minutes: 5,
  });
  await events.create({ agent: "isabel", state: "NEEDS_HELP", type: "alerta", text: "Falhou" });
  await events.create({ agent: "isabel", state: "IDLE", text: "Disponível" });
  const controller = new OfficeController(new OfficeService(registry, events), () => token);
  return { events, controller };
}

describe("OfficeController", () => {
  it("devolve a equipa e os eventos no formato do AI Office", async () => {
    const { controller, events } = await setup();
    const res = await controller.events(get("", "token-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body.agentes).toEqual([
      { id: "isabel", nome: "Assistente da Isabel", funcao: "Trata da agenda" },
    ]);
    expect(body.eventos).toEqual([
      {
        n: 1,
        agora: events.events[0].createdAt.getTime(),
        agente: "isabel",
        estado: "trabalho",
        tipo: null,
        texto: "A tratar de um pedido",
        ferramenta: null,
        minutos: 0,
      },
      expect.objectContaining({
        n: 2,
        estado: "trabalho",
        tipo: "marcacao",
        ferramenta: "calendar",
        minutos: 5,
      }),
      expect.objectContaining({ n: 3, estado: "ajuda", tipo: "alerta" }),
      expect.objectContaining({ n: 4, estado: "pausa", tipo: null }),
    ]);
    expect(body).toMatchObject({ proximo: 4, haMais: false });
  });

  it("devolve só o que vem depois de `desde`, e avisa quando ficou mais por enviar", async () => {
    const { controller } = await setup();
    const first = await (await controller.events(get("?desde=1&limite=2", "token-1"))).json();
    expect(first.eventos.map((e: { n: number }) => e.n)).toEqual([2, 3]);
    expect(first).toMatchObject({ proximo: 3, haMais: true });

    const rest = await (await controller.events(get("?desde=3", "token-1"))).json();
    expect(rest.eventos.map((e: { n: number }) => e.n)).toEqual([4]);

    const nothing = await (await controller.events(get("?desde=4", "token-1"))).json();
    expect(nothing).toMatchObject({ eventos: [], proximo: 4, haMais: false });
  });

  it("filtra a partir de um instante", async () => {
    const { controller, events } = await setup();
    events.events[0].createdAt = new Date("2026-11-11T23:00:00Z");
    events.events[1].createdAt = new Date("2026-11-12T09:00:00Z");
    events.events[2].createdAt = new Date("2026-11-12T09:05:00Z");
    events.events[3].createdAt = new Date("2026-11-12T09:06:00Z");

    const body = await (
      await controller.events(get("?apos=2026-11-12T00:00:00Z", "token-1"))
    ).json();
    expect(body.eventos.map((e: { n: number }) => e.n)).toEqual([2, 3, 4]);
  });

  it("401 sem token ou com o token errado", async () => {
    const { controller } = await setup();
    expect((await controller.events(get())).status).toBe(401);
    expect((await controller.events(get("", "outro"))).status).toBe(401);
  });

  it("sem token configurado, recusa tudo", async () => {
    const { controller } = await setup("");
    expect((await controller.events(get("", ""))).status).toBe(503);
  });

  it("400 com parâmetros inválidos", async () => {
    const { controller } = await setup();
    for (const query of ["?desde=-1", "?limite=0", "?limite=5000", "?desde=abc", "?apos=ontem"])
      expect((await controller.events(get(query, "token-1"))).status).toBe(400);
  });
});
