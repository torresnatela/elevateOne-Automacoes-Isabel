import type { PrismaClient } from "@prisma/client";

/** Contrato de persistência do que o admin mudou em cada agente. */
export interface AgentSettingRepository {
  /** As instruções que o admin escreveu, ou `null` se usa as de origem. */
  getPrompt(agentId: string): Promise<string | null>;
  setPrompt(agentId: string, prompt: string): Promise<void>;
  /** Volta às instruções de origem. */
  clearPrompt(agentId: string): Promise<void>;
}

export class PrismaAgentSettingRepository implements AgentSettingRepository {
  constructor(private readonly db: PrismaClient) {}

  async getPrompt(agentId: string) {
    const row = await this.db.agentSetting.findUnique({ where: { agentId } });
    return row?.prompt ?? null;
  }

  async setPrompt(agentId: string, prompt: string) {
    await this.db.agentSetting.upsert({
      where: { agentId },
      update: { prompt },
      create: { agentId, prompt },
    });
  }

  async clearPrompt(agentId: string) {
    await this.db.agentSetting.deleteMany({ where: { agentId } });
  }
}
