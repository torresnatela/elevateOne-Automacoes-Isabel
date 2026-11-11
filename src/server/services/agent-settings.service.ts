import type { AgentRegistry } from "@/server/agents/registry";
import type { AgentSettingRepository } from "@/server/repositories/agent-setting.repository";

/** Um agente como o admin o vê: as instruções em uso e as de origem. */
export interface AgentSettingsView {
  id: string;
  name: string;
  /** As instruções em uso. */
  prompt: string;
  /** As instruções de origem (do código). */
  defaultPrompt: string;
  /** O admin mudou-as. */
  customized: boolean;
}

/** As instruções de cada agente: as do código, ou as que o admin escreveu por cima. */
export class AgentSettingsService {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly repository: AgentSettingRepository,
  ) {}

  /** As instruções em uso de um agente. */
  async promptOf(agentId: string): Promise<string> {
    const agent = this.registry.getAgent(agentId);
    return (await this.repository.getPrompt(agentId)) ?? agent.prompt;
  }

  async list(): Promise<AgentSettingsView[]> {
    return Promise.all(
      this.registry.listAgents().map(async (agent) => {
        const custom = await this.repository.getPrompt(agent.id);
        return {
          id: agent.id,
          name: agent.name,
          prompt: custom ?? agent.prompt,
          defaultPrompt: agent.prompt,
          customized: custom !== null,
        };
      }),
    );
  }

  async setPrompt(agentId: string, prompt: string): Promise<void> {
    this.registry.getAgent(agentId);
    await this.repository.setPrompt(agentId, prompt.trim());
  }

  async resetPrompt(agentId: string): Promise<void> {
    this.registry.getAgent(agentId);
    await this.repository.clearPrompt(agentId);
  }
}
