import { z } from "zod";
import type { AgentDefinition, ToolDefinition } from "@/server/agents/core/types";
import { AgentRegistry } from "@/server/agents/registry";

const tool: ToolDefinition<{ q: string }> = {
  name: "procurar",
  description: "Procura.",
  schema: z.object({ q: z.string() }),
  requiresConfirmation: false,
  execute: async () => "ok",
};

const agent: AgentDefinition = {
  id: "assistente",
  name: "Assistente",
  prompt: "És um assistente.",
  tools: ["procurar"],
  channels: ["WEB"],
  office: { agentId: "eva", workingText: "A responder" },
};

describe("AgentRegistry", () => {
  it("devolve o agente registado e as suas ferramentas", () => {
    const registry = new AgentRegistry().registerTool(tool).registerAgent(agent);
    expect(registry.getAgent("assistente")).toBe(agent);
    expect(registry.toolsOf(agent).map((t) => t.name)).toEqual(["procurar"]);
    expect(registry.listAgents()).toEqual([agent]);
  });

  it("recusa um agente com uma ferramenta que não existe", () => {
    expect(() => new AgentRegistry().registerAgent(agent)).toThrow(/procurar/);
  });

  it("recusa agentes e ferramentas repetidos", () => {
    const registry = new AgentRegistry().registerTool(tool).registerAgent(agent);
    expect(() => registry.registerTool(tool)).toThrow(/repetida/);
    expect(() => registry.registerAgent(agent)).toThrow(/repetido/);
  });

  it("responde 404 a um agente desconhecido", () => {
    expect(() => new AgentRegistry().getAgent("x")).toThrow(
      expect.objectContaining({ status: 404, code: "AGENT_NOT_FOUND" }),
    );
  });
});
