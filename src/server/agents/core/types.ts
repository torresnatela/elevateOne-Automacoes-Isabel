import type { z } from "zod";
import type { OfficeEntryType, OfficeTool } from "@/server/models/agent-event.model";
import type { Channel, ContentBlock } from "@/server/models/conversation.model";

/** Onde e para quem uma ferramenta corre. */
export interface ToolContext {
  agentId: string;
  conversationId: string;
  channel: Channel;
  userId: string | null;
}

/** Como uma ferramenta feita aparece no AI Office. */
export interface ToolOfficeInfo {
  type: OfficeEntryType;
  tool: OfficeTool;
  /** Os minutos que uma pessoa levaria a fazer o mesmo. */
  minutes: number;
  /** A linha da atividade, no passado: «Marcou uma reunião». */
  doneText: string;
}

/**
 * Uma ferramenta que um agente pode usar. Para acrescentar uma: um ficheiro em
 * `src/server/agents/tools/` com esta forma, registado no `AgentRegistry`.
 */
export interface ToolDefinition<Input = unknown> {
  /** O nome que o modelo vê (snake_case). */
  name: string;
  /** Para o modelo: o que faz e quando usar. */
  description: string;
  /** Valida o que o modelo manda; o que sai (com os valores por omissão) é o que `execute` recebe. */
  schema: z.ZodType<Input, z.ZodTypeDef, unknown>;
  /** Escreve no mundo (marca, envia, apaga): só corre depois de quem pediu dizer que sim. */
  requiresConfirmation: boolean;
  execute(ctx: ToolContext, input: Input): Promise<unknown>;
  /**
   * Para as que exigem confirmação: o que vai ser feito, por palavras, tal como é mostrado
   * a quem pediu antes do «sim». Escrito pelo sistema a partir do input, não pelo modelo.
   * Se falhar (o compromisso a cancelar não existe), a ação nem chega a ser proposta.
   */
  describe?(ctx: ToolContext, input: Input): Promise<string> | string;
  /** O que quem espera vê enquanto corre: «A consultar a base de conhecimento…». */
  statusText?: string;
  /** Sem isto, a ferramenta não aparece na atividade (uma consulta, por exemplo). */
  office?: ToolOfficeInfo;
}

/**
 * Um agente: uma automação. Para acrescentar uma: um ficheiro em
 * `src/server/agents/definitions/` com esta forma, registado no `AgentRegistry`.
 */
export interface AgentDefinition {
  id: string;
  name: string;
  /** As instruções de base (o admin pode substituí-las sem deploy, mais tarde). */
  prompt: string;
  /** Os nomes das ferramentas que pode usar. */
  tools: readonly string[];
  channels: readonly Channel[];
  office: {
    /** O id do colaborador no AI Office. */
    agentId: string;
    /** O que faz, como aparece na ficha dele no escritório: «Tira as dúvidas da equipa». */
    role?: string;
    /** A linha enquanto trabalha: «A responder a uma dúvida da equipa». */
    workingText: string;
    /** A tarefa que conta quando responde a uma mensagem (sem isto, só contam as ferramentas). */
    done?: ToolOfficeInfo;
  };
}

export interface LlmMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}

export interface LlmTool {
  name: string;
  description: string;
  /** JSON Schema do input. */
  inputSchema: Record<string, unknown>;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  tools: LlmTool[];
  /** Com isto, o texto chega aos bocados, à medida que o modelo escreve. */
  onText?: (delta: string) => void;
}

export interface LlmResponse {
  content: ContentBlock[];
  /** `tool_use` pede ferramentas; `refusal` recusou; o resto acabou a vez. */
  stopReason: string | null;
}

/** O modelo de linguagem. O núcleo depende desta interface, não do fornecedor. */
export interface LlmClient {
  respond(request: LlmRequest): Promise<LlmResponse>;
}
