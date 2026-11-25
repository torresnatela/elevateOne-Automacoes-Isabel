import { randomUUID } from "node:crypto";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AppError } from "@/server/lib/errors";
import type { NewAgentEvent } from "@/server/models/agent-event.model";
import {
  isToolUseBlock,
  textBlock,
  textOf,
  type ContentBlock,
  type Conversation,
  type ToolResultBlock,
  type ToolUseBlock,
} from "@/server/models/conversation.model";
import type { AgentEventRepository } from "@/server/repositories/agent-event.repository";
import type { ConversationRepository } from "@/server/repositories/conversation.repository";
import type { PendingActionRepository } from "@/server/repositories/pending-action.repository";
import type { AgentRegistry } from "../registry";
import type {
  AgentDefinition,
  LlmClient,
  LlmMessage,
  LlmTool,
  ToolContext,
  ToolDefinition,
} from "./types";

/** Quantas vezes, no máximo, o modelo é chamado para responder a uma mensagem. */
export const MAX_TURNS = 8;

/** Quanto tempo uma ação espera pelo «sim» antes de caducar. */
export const CONFIRMATION_TTL_MS = 30 * 60_000;

/** As ferramentas com que o modelo executa ou desiste de uma ação proposta. */
export const CONFIRM_TOOL = "confirmar_acao";
export const CANCEL_TOOL = "cancelar_acao";

const REFUSAL_TEXT = "Desculpe, não consigo ajudar com esse pedido.";

const ACTION_ID_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "O id da ação, como veio quando foi proposta." },
  },
  required: ["id"],
  additionalProperties: false,
};

const CONFIRMATION_TOOLS: LlmTool[] = [
  {
    name: CONFIRM_TOOL,
    description:
      "Executa uma ação que ficou à espera de confirmação. Chama-a só depois de quem pediu responder, numa mensagem nova, que confirma (sim, pode, avança). Se a resposta não for um sim claro, ou se pedir uma mudança, não confirmes: cancela e propõe de novo.",
    inputSchema: ACTION_ID_SCHEMA,
  },
  {
    name: CANCEL_TOOL,
    description:
      "Desiste de uma ação que ficou à espera de confirmação, porque quem pediu disse que não ou mudou de ideias.",
    inputSchema: ACTION_ID_SCHEMA,
  },
];

export interface RunInput {
  conversationId: string;
  /** O que a pessoa escreveu. */
  text: string;
  /** O que o agente precisa de saber nesta vez e não vem na mensagem (a data e a hora de agora). */
  context?: string;
  /** O que veio com a mensagem (uma imagem, um documento), já em blocos que o modelo lê. */
  attachments?: ContentBlock[];
  /** Para mostrar a resposta a aparecer: cada bocado de texto que o modelo escreve. */
  onText?: (delta: string) => void;
  /** Para mostrar o que o agente está a fazer: chamado quando começa a usar uma ferramenta. */
  onTool?: (tool: { name: string; statusText: string | null }) => void;
}

/** De onde vêm as instruções em uso de um agente (o admin pode tê-las mudado). */
export interface PromptSource {
  promptOf(agentId: string): Promise<string>;
}

export interface RunResult {
  /**
   * A resposta do agente, para mostrar ou enviar. Quando ficou alguma ação à espera
   * de confirmação, acaba com o resumo exato dela, escrito pelo sistema e não pelo modelo.
   */
  text: string;
  /** As ações que ficaram à espera de confirmação nesta vez, como foram mostradas. */
  pending: string[];
}

export interface AgentRunnerDeps {
  registry: AgentRegistry;
  llm: LlmClient;
  conversations: ConversationRepository;
  events: AgentEventRepository;
  /** Sem isto, valem as instruções do código. */
  prompts?: PromptSource;
  /** Sem isto, as ferramentas que exigem confirmação nunca correm. */
  pendingActions?: PendingActionRepository;
  now?: () => Date;
}

type Say = (event: Omit<NewAgentEvent, "agent">) => Promise<unknown>;

/** O que uma vez (a resposta a uma mensagem) leva consigo. */
interface Turn {
  runId: string;
  ctx: ToolContext;
  tools: ToolDefinition[];
  say: Say;
  /** As ações propostas nesta vez, como vão ser mostradas a quem pediu. */
  proposed: string[];
}

const failed = (use: ToolUseBlock, content: string): ToolResultBlock => ({
  type: "tool_result",
  tool_use_id: use.id,
  content,
  is_error: true,
});

const succeeded = (use: ToolUseBlock, output: unknown): ToolResultBlock => ({
  type: "tool_result",
  tool_use_id: use.id,
  content: typeof output === "string" ? output : JSON.stringify(output),
});

/**
 * Faz um agente responder a uma mensagem: chama o modelo, corre as ferramentas que
 * ele pede, guarda a conversa e conta ao AI Office o que foi feito. Os canais
 * (chat, WhatsApp) entregam-lhe as mensagens; não sabe nada deles.
 *
 * As ferramentas que escrevem no mundo não correm quando o modelo as pede: ficam
 * guardadas como ação pendente, o resumo delas vai na resposta, e só correm numa
 * vez seguinte, depois de uma mensagem nova de quem pediu.
 */
export class AgentRunner {
  private readonly now: () => Date;

  constructor(private readonly deps: AgentRunnerDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async run(input: RunInput): Promise<RunResult> {
    const { registry, conversations, events } = this.deps;
    const conversation = await conversations.findById(input.conversationId);
    if (!conversation)
      throw new AppError("Conversa não encontrada.", 404, "CONVERSATION_NOT_FOUND");
    const agent = registry.getAgent(conversation.agentId);
    const say: Say = (event) => events.create({ agent: agent.office.agentId, ...event });

    const history = await conversations.listMessages(conversation.id);
    const messages: LlmMessage[] = history.map((m) => ({
      role: m.role === "USER" ? "user" : "assistant",
      content: m.content,
    }));
    const push = async (role: LlmMessage["role"], content: ContentBlock[]) => {
      messages.push({ role, content });
      await conversations.addMessage(
        conversation.id,
        role === "user" ? "USER" : "ASSISTANT",
        content,
      );
    };

    await push("user", [
      ...(input.context ? [textBlock(input.context)] : []),
      // Os anexos antes do pedido: o modelo lê primeiro o documento e depois o que se quer dele.
      ...(input.attachments ?? []),
      textBlock(input.text),
    ]);
    await say({ state: "WORKING", text: agent.office.workingText });

    const turn: Turn = {
      runId: randomUUID(),
      ctx: {
        agentId: agent.id,
        conversationId: conversation.id,
        channel: conversation.channel,
        userId: conversation.userId,
      },
      tools: registry.toolsOf(agent),
      say,
      proposed: [],
    };

    try {
      const answer = await this.loop(agent, conversation, messages, push, turn, input);
      if (agent.office.done) {
        const { type, tool, minutes, doneText } = agent.office.done;
        await say({ state: "WORKING", type, tool, minutes, text: doneText });
      }
      await say({ state: "IDLE", text: "Disponível" });
      return { text: withConfirmation(answer, turn.proposed), pending: turn.proposed };
    } catch (error) {
      await say({ state: "NEEDS_HELP", type: "alerta", text: `${agent.name} precisa de ajuda` });
      throw error;
    }
  }

  private async loop(
    agent: AgentDefinition,
    conversation: Conversation,
    messages: LlmMessage[],
    push: (role: LlmMessage["role"], content: ContentBlock[]) => Promise<void>,
    turn: Turn,
    hooks: Pick<RunInput, "onText" | "onTool">,
  ): Promise<string> {
    const canConfirm = !!this.deps.pendingActions && turn.tools.some((t) => t.requiresConfirmation);
    const llmTools: LlmTool[] = [
      ...turn.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: zodToJsonSchema(t.schema, { $refStrategy: "none" }) as Record<string, unknown>,
      })),
      ...(canConfirm ? CONFIRMATION_TOOLS : []),
    ];
    const system = this.deps.prompts ? await this.deps.prompts.promptOf(agent.id) : agent.prompt;

    for (let i = 0; i < MAX_TURNS; i++) {
      const response = await this.deps.llm.respond({
        system,
        messages,
        tools: llmTools,
        model: agent.llm?.model,
        effort: agent.llm?.effort,
        onText: hooks.onText,
      });

      if (response.stopReason === "refusal") {
        await push("assistant", [textBlock(REFUSAL_TEXT)]);
        return REFUSAL_TEXT;
      }

      await push("assistant", response.content);
      const uses = response.content.filter(isToolUseBlock);
      if (response.stopReason !== "tool_use" || uses.length === 0) return textOf(response.content);

      // Uma a uma, pela ordem pedida; os resultados voltam todos na mesma mensagem.
      const results: ToolResultBlock[] = [];
      for (const use of uses) {
        const statusText = turn.tools.find((t) => t.name === use.name)?.statusText ?? null;
        hooks.onTool?.({ name: use.name, statusText });
        results.push(await this.useTool(use, turn, canConfirm));
      }
      await push("user", results);
    }

    throw new AppError("O agente não conseguiu concluir o pedido.", 500, "AGENT_LOOP_LIMIT");
  }

  private async useTool(
    use: ToolUseBlock,
    turn: Turn,
    canConfirm: boolean,
  ): Promise<ToolResultBlock> {
    if (canConfirm && (use.name === CONFIRM_TOOL || use.name === CANCEL_TOOL))
      return this.settle(use, turn);

    const tool = turn.tools.find((t) => t.name === use.name);
    if (!tool) return failed(use, `A ferramenta «${use.name}» não existe.`);

    const parsed = tool.schema.safeParse(use.input);
    if (!parsed.success) return failed(use, `Input inválido: ${parsed.error.message}`);

    if (tool.requiresConfirmation) return this.propose(use, tool, parsed.data, turn);
    return this.execute(use, tool, parsed.data, turn);
  }

  /** Corre a ferramenta e conta-o ao escritório. */
  private async execute(
    use: ToolUseBlock,
    tool: ToolDefinition,
    input: unknown,
    turn: Turn,
  ): Promise<ToolResultBlock> {
    try {
      const output = await tool.execute(turn.ctx, input);
      if (tool.office) {
        const { type, tool: app, minutes, doneText } = tool.office;
        await turn.say({ state: "WORKING", type, tool: app, minutes, text: doneText });
      }
      return succeeded(use, output);
    } catch (error) {
      // Um erro que a própria pessoa resolve (ligar a conta, dar uma permissão) não é uma avaria:
      // o modelo explica-lho, e o escritório não é chamado.
      const fixable = error instanceof AppError && error.status < 500;
      if (!fixable)
        await turn.say({
          state: "NEEDS_HELP",
          type: "alerta",
          text: `Falhou: ${tool.name}`,
          tool: tool.office?.tool ?? null,
        });
      return failed(use, error instanceof Error ? error.message : "A ferramenta falhou.");
    }
  }

  /** Em vez de correr uma ferramenta que escreve, guarda-a à espera do «sim». */
  private async propose(
    use: ToolUseBlock,
    tool: ToolDefinition,
    input: unknown,
    turn: Turn,
  ): Promise<ToolResultBlock> {
    const pending = this.deps.pendingActions;
    if (!pending)
      return failed(
        use,
        "Esta ação exige a confirmação de quem pediu, que não está disponível neste canal.",
      );

    let description: string;
    try {
      description = tool.describe
        ? await tool.describe(turn.ctx, input)
        : `${tool.name}: ${JSON.stringify(input)}`;
    } catch (error) {
      // Sem conseguir dizer o que vai fazer (o compromisso não existe, por exemplo), não propõe.
      return failed(use, error instanceof Error ? error.message : "A ferramenta falhou.");
    }

    // Uma proposta nova substitui as que ficaram sem resposta: o «sim» vale para o que se acabou de mostrar.
    if (turn.proposed.length === 0) await pending.cancelAllOf(turn.ctx.conversationId);
    const action = await pending.create({
      conversationId: turn.ctx.conversationId,
      runId: turn.runId,
      toolName: tool.name,
      input,
      description,
      expiresAt: new Date(this.now().getTime() + CONFIRMATION_TTL_MS),
    });
    turn.proposed.push(description);
    return succeeded(use, {
      aguarda_confirmacao: true,
      acao_id: action.id,
      nota:
        "Nada foi feito ainda. O sistema junta à tua resposta o resumo exato desta ação e o pedido de confirmação: " +
        `não o repitas, diz só numa frase que precisas da confirmação. Quando a pessoa responder que sim, chama ${CONFIRM_TOOL} com este id; ` +
        `se disser que não ou pedir uma mudança, chama ${CANCEL_TOOL}.`,
    });
  }

  /** `confirmar_acao` e `cancelar_acao`: executa ou desiste de uma ação proposta antes. */
  private async settle(use: ToolUseBlock, turn: Turn): Promise<ToolResultBlock> {
    const pending = this.deps.pendingActions!;
    const id = (use.input as { id?: unknown } | null)?.id;
    const action = typeof id === "string" ? await pending.findById(id) : null;
    if (!action || action.conversationId !== turn.ctx.conversationId)
      return failed(use, "Não há nenhuma ação com esse id nesta conversa.");
    if (action.status !== "PENDING")
      return failed(use, `Essa ação já não está à espera (estado: ${action.status}).`);

    if (use.name === CANCEL_TOOL) {
      await pending.resolve(action.id, "CANCELLED");
      return succeeded(use, { cancelada: true });
    }

    // A garantia: quem pediu tem de ter respondido depois de ver o resumo.
    if (action.runId === turn.runId)
      return failed(
        use,
        "Esta ação foi proposta agora e quem pediu ainda não respondeu. Acaba a tua resposta e espera pela confirmação.",
      );
    if (action.expiresAt <= this.now()) {
      await pending.resolve(action.id, "EXPIRED");
      return failed(use, "A confirmação chegou tarde demais e a ação caducou. Propõe-na de novo.");
    }

    const tool = turn.tools.find((t) => t.name === action.toolName);
    const parsed = tool?.schema.safeParse(action.input);
    if (!tool || !parsed?.success) {
      await pending.resolve(action.id, "FAILED");
      return failed(use, "Essa ação já não pode ser executada. Propõe-na de novo.");
    }
    // Fica confirmada antes de correr: se chegarem dois «sim», só o primeiro a leva.
    if (!(await pending.resolve(action.id, "CONFIRMED")))
      return failed(use, "Essa ação já não está à espera.");

    const result = await this.execute(use, tool, parsed.data, turn);
    if (result.is_error) await pending.setStatus(action.id, "FAILED");
    return result;
  }
}

/** A resposta, com o resumo exato do que ficou à espera de confirmação. */
function withConfirmation(answer: string, proposed: string[]): string {
  if (proposed.length === 0) return answer;
  const summary =
    proposed.length === 1
      ? `Para confirmar:\n${proposed[0]}`
      : `Para confirmar:\n${proposed.map((p, i) => `${i + 1}. ${p}`).join("\n")}`;
  return [answer, summary, "Responda *sim* para avançar ou *não* para cancelar."]
    .filter(Boolean)
    .join("\n\n");
}
