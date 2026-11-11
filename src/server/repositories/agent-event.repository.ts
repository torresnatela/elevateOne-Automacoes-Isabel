import type { AgentEvent as PrismaAgentEvent, PrismaClient } from "@prisma/client";
import type {
  AgentEvent,
  NewAgentEvent,
  OfficeEntryType,
  OfficeTool,
} from "@/server/models/agent-event.model";

/** Contrato de persistência dos eventos que o AI Office mostra. */
export interface AgentEventRepository {
  create(data: NewAgentEvent): Promise<AgentEvent>;
  /** Os eventos depois do n.º `afterSeq` (e, com `since`, a partir desse instante), por ordem, até `limit`. */
  listAfter(afterSeq: number, limit: number, since?: Date): Promise<AgentEvent[]>;
}

function toDomain(row: PrismaAgentEvent): AgentEvent {
  return {
    ...row,
    type: row.type as OfficeEntryType | null,
    tool: row.tool as OfficeTool | null,
  };
}

export class PrismaAgentEventRepository implements AgentEventRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(data: NewAgentEvent) {
    const row = await this.db.agentEvent.create({
      data: {
        agent: data.agent,
        state: data.state,
        type: data.type ?? null,
        text: data.text,
        tool: data.tool ?? null,
        minutes: data.minutes ?? 0,
      },
    });
    return toDomain(row);
  }

  async listAfter(afterSeq: number, limit: number, since?: Date) {
    const rows = await this.db.agentEvent.findMany({
      where: { seq: { gt: afterSeq }, ...(since ? { createdAt: { gte: since } } : {}) },
      orderBy: { seq: "asc" },
      take: limit,
    });
    return rows.map(toDomain);
  }
}
