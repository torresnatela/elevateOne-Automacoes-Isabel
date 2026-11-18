import { AgentRegistry } from "@/server/agents/registry";
import { OfficeService } from "@/server/services/office.service";
import { FakeAgentEventRepository } from "../../setup/fake-agent.repositories";

function setup() {
  const registry = new AgentRegistry()
    .registerAgent({
      id: "assistente-interno",
      name: "Assistente interno",
      prompt: "p",
      tools: [],
      channels: ["WEB"],
      office: { agentId: "interno", role: "Responde à equipa", workingText: "A responder" },
    })
    .registerAgent({
      id: "assistente-isabel",
      name: "Assistente pessoal",
      prompt: "p",
      tools: [],
      channels: ["WHATSAPP"],
      office: { agentId: "isabel", role: "Trata da agenda", workingText: "A tratar" },
    });
  const events = new FakeAgentEventRepository();
  return { events, service: new OfficeService(registry, events) };
}

describe("OfficeService.today", () => {
  it("dá o estado de cada agente pelo seu último evento, e livre a quem não fez nada", async () => {
    const { events, service } = setup();
    await events.create({ agent: "isabel", state: "WORKING", text: "A tratar de um pedido" });

    const today = await service.today(new Date(0));

    expect(today.agentes).toEqual([
      {
        id: "interno",
        nome: "Assistente interno",
        funcao: "Responde à equipa",
        estado: "pausa",
        texto: "Disponível",
      },
      {
        id: "isabel",
        nome: "Assistente pessoal",
        funcao: "Trata da agenda",
        estado: "trabalho",
        texto: "A tratar de um pedido",
      },
    ]);
  });

  it("lista as tarefas feitas, da mais recente, sem as mudanças de estado nem os alertas", async () => {
    const { events, service } = setup();
    await events.create({ agent: "isabel", state: "WORKING", text: "A tratar" });
    await events.create({
      agent: "isabel",
      state: "WORKING",
      type: "marcacao",
      text: "Marcou uma reunião",
      minutes: 5,
    });
    await events.create({ agent: "isabel", state: "NEEDS_HELP", type: "alerta", text: "Falhou" });
    await events.create({
      agent: "interno",
      state: "WORKING",
      type: "mensagem",
      text: "Respondeu à equipa",
      minutes: 3,
    });
    await events.create({ agent: "isabel", state: "IDLE", text: "Disponível" });

    const today = await service.today(new Date(0));

    expect(today.recentes.map((e) => [e.agente, e.texto, e.minutos])).toEqual([
      ["Assistente interno", "Respondeu à equipa", 3],
      ["Assistente pessoal", "Marcou uma reunião", 5],
    ]);
    expect(today.minutos).toBe(8);
    expect(today.agentes.find((a) => a.id === "isabel")?.estado).toBe("pausa");
  });

  it("mostra no máximo as cinco tarefas mais recentes, mas conta os minutos de todas", async () => {
    const { events, service } = setup();
    for (let i = 1; i <= 7; i++) {
      await events.create({
        agent: "isabel",
        state: "WORKING",
        type: "email",
        text: `Email ${i}`,
        minutes: 2,
      });
    }

    const today = await service.today(new Date(0));

    expect(today.recentes.map((e) => e.texto)).toEqual([
      "Email 7",
      "Email 6",
      "Email 5",
      "Email 4",
      "Email 3",
    ]);
    expect(today.minutos).toBe(14);
  });
});
