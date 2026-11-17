/**
 * O que um agente fez, no formato que o AI Office mostra: espelha a `Entrada` e o
 * `EstadoDoAgente` de `src/mapa/atividade.ts` do repositório ai-office. Os valores
 * de `type` e `tool` são os de lá, para o escritório os desenhar sem tradução.
 */
export const AGENT_STATES = ["WORKING", "IDLE", "NEEDS_HELP"] as const;
export type AgentState = (typeof AGENT_STATES)[number];

/** Os tipos de entrada do AI Office (o ícone de cada linha da atividade). */
export const OFFICE_ENTRY_TYPES = [
  "lead",
  "venda",
  "proposta",
  "marcacao",
  "videochamada",
  "apoio",
  "chamada",
  "fatura",
  "arquivo",
  "contrato",
  "projeto",
  "redes",
  "recrutamento",
  "email",
  "mensagem",
  "encomenda",
  "visita",
  "coordenacao",
  "reuniao",
  "mural",
  "alerta",
  "resolvido",
] as const;
export type OfficeEntryType = (typeof OFFICE_ENTRY_TYPES)[number];

/** As apps cujo ícone o AI Office sabe mostrar na etiqueta do agente. */
export const OFFICE_TOOLS = [
  "gmail",
  "calendar",
  "docs",
  "sheets",
  "meet",
  "whatsapp",
  "claude",
] as const;
export type OfficeTool = (typeof OFFICE_TOOLS)[number];

export interface AgentEvent {
  id: string;
  /** A ordem em que aconteceu: o AI Office pede «depois do n.º N». */
  seq: number;
  /** O id do colaborador no AI Office. */
  agent: string;
  state: AgentState;
  /** `null` quando é só uma mudança de estado (começou, acabou). */
  type: OfficeEntryType | null;
  text: string;
  tool: OfficeTool | null;
  /** Os minutos que uma pessoa levaria (0 nos alertas e nas mudanças de estado). */
  minutes: number;
  createdAt: Date;
}

export interface NewAgentEvent {
  agent: string;
  state: AgentState;
  type?: OfficeEntryType | null;
  text: string;
  tool?: OfficeTool | null;
  minutes?: number;
}
