import { AppError } from "@/server/lib/errors";
import type { AgentDefinition, ToolDefinition } from "./core/types";

/** Os agentes e as ferramentas que existem. Registar aqui é o que os liga ao sistema. */
export class AgentRegistry {
  private readonly agents = new Map<string, AgentDefinition>();
  private readonly tools = new Map<string, ToolDefinition>();

  registerTool<Input>(tool: ToolDefinition<Input>): this {
    if (this.tools.has(tool.name)) throw new Error(`Ferramenta repetida: ${tool.name}`);
    this.tools.set(tool.name, tool as ToolDefinition);
    return this;
  }

  /** As ferramentas do agente têm de estar registadas antes dele. */
  registerAgent(agent: AgentDefinition): this {
    if (this.agents.has(agent.id)) throw new Error(`Agente repetido: ${agent.id}`);
    for (const name of agent.tools) {
      if (!this.tools.has(name))
        throw new Error(`O agente ${agent.id} usa uma ferramenta que não existe: ${name}`);
    }
    this.agents.set(agent.id, agent);
    return this;
  }

  getAgent(id: string): AgentDefinition {
    const agent = this.agents.get(id);
    if (!agent) throw new AppError("Agente não encontrado.", 404, "AGENT_NOT_FOUND");
    return agent;
  }

  toolsOf(agent: AgentDefinition): ToolDefinition[] {
    return agent.tools.map((name) => this.tools.get(name)!);
  }

  listAgents(): AgentDefinition[] {
    return [...this.agents.values()];
  }
}
