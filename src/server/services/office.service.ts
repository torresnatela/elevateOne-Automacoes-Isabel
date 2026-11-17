import type { AgentRegistry } from "@/server/agents/registry";
import type { AgentEvent, AgentState } from "@/server/models/agent-event.model";
import type { AgentEventRepository } from "@/server/repositories/agent-event.repository";

/**
 * O que o AI Office lê. Os nomes dos campos são os da `Entrada` e do `EstadoDoAgente`
 * de `src/mapa/atividade.ts` do repositório ai-office, para ele os usar sem tradução.
 */
export type OfficeState = "trabalho" | "pausa" | "ajuda";

export interface OfficeAgent {
  id: string;
  nome: string;
  funcao: string;
}

export interface OfficeEvent {
  /** O número do evento: pede-se o que vem depois dele com `?desde=`. */
  n: number;
  /** Quando aconteceu (ms desde 1970). */
  agora: number;
  agente: string;
  estado: OfficeState;
  /** `null` quando é só uma mudança de estado (começou, ficou livre). */
  tipo: string | null;
  texto: string;
  ferramenta: string | null;
  /** Os minutos que uma pessoa levaria. */
  minutos: number;
}

export interface OfficeFeed {
  agentes: OfficeAgent[];
  eventos: OfficeEvent[];
  /** O `desde` do próximo pedido. */
  proximo: number;
  /** Ficaram eventos por enviar: pedir já outra vez. */
  haMais: boolean;
}

const STATES: Record<AgentState, OfficeState> = {
  WORKING: "trabalho",
  IDLE: "pausa",
  NEEDS_HELP: "ajuda",
};

const toOffice = (event: AgentEvent): OfficeEvent => ({
  n: event.seq,
  agora: event.createdAt.getTime(),
  agente: event.agent,
  estado: STATES[event.state],
  tipo: event.type,
  texto: event.text,
  ferramenta: event.tool,
  minutos: event.minutes,
});

/** O que os agentes fizeram, como o AI Office o mostra. */
export class OfficeService {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly events: AgentEventRepository,
  ) {}

  /** A equipa digital: um colaborador por agente. */
  agents(): OfficeAgent[] {
    return this.registry.listAgents().map((agent) => ({
      id: agent.office.agentId,
      nome: agent.name,
      funcao: agent.office.role ?? "",
    }));
  }

  /** Os eventos depois do n.º `after` (e, com `since`, só a partir desse instante), por ordem. */
  async feed(after: number, limit: number, since?: Date): Promise<OfficeFeed> {
    // Pede um a mais para saber se ficou algum por enviar.
    const rows = await this.events.listAfter(after, limit + 1, since);
    const page = rows.slice(0, limit);
    return {
      agentes: this.agents(),
      eventos: page.map(toOffice),
      proximo: page.at(-1)?.seq ?? after,
      haMais: rows.length > limit,
    };
  }
}
