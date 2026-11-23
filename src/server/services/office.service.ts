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

/** Um agente e o que está a fazer agora: o seu último evento. */
export interface OfficeAgentNow extends OfficeAgent {
  estado: OfficeState;
  texto: string;
}

/** Uma tarefa feita, para a lista da atividade. */
export interface OfficeTask {
  n: number;
  agora: Date;
  /** O nome do agente, como a equipa o conhece. */
  agente: string;
  tipo: string;
  texto: string;
  minutos: number;
}

/** O dia da equipa digital, para a página de início. */
export interface OfficeToday {
  agentes: OfficeAgentNow[];
  /** As tarefas mais recentes, da última para trás. */
  recentes: OfficeTask[];
  /** Os minutos que as tarefas do dia levariam a uma pessoa. */
  minutos: number;
}

/** Quantas tarefas a página de início mostra. */
const RECENT_TASKS = 5;
/** Os eventos de um dia que se leem, no máximo. */
const DAY_EVENTS = 1000;

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

  /** O que a equipa digital fez desde `since` (o início do dia): o estado de cada agente e as tarefas feitas. */
  async today(since: Date): Promise<OfficeToday> {
    const rows = await this.events.listAfter(0, DAY_EVENTS, since);
    const agents = this.agents();
    const names = new Map(agents.map((a) => [a.id, a.nome]));

    const last = new Map<string, AgentEvent>();
    for (const event of rows) last.set(event.agent, event);

    const tasks = rows.filter((e) => e.type !== null && e.type !== "alerta");
    return {
      agentes: agents.map((agent) => {
        const event = last.get(agent.id);
        return {
          ...agent,
          estado: event ? STATES[event.state] : "pausa",
          texto: event?.text ?? "Disponível",
        };
      }),
      recentes: tasks
        .slice(-RECENT_TASKS)
        .reverse()
        .map((e) => ({
          n: e.seq,
          agora: e.createdAt,
          agente: names.get(e.agent) ?? e.agent,
          tipo: e.type!,
          texto: e.text,
          minutos: e.minutes,
        })),
      minutos: tasks.reduce((sum, e) => sum + e.minutes, 0),
    };
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
