import Anthropic from "@anthropic-ai/sdk";
import type { LlmClient, LlmEffort, LlmRequest, LlmResponse } from "@/server/agents/core/types";
import { AppError } from "@/server/lib/errors";
import type { ContentBlock } from "@/server/models/conversation.model";

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Effort = LlmEffort;

/**
 * Os blocos de raciocínio só valem enquanto o prompt, as ferramentas e as mensagens
 * anteriores não mudam, e aqui mudam (o admin edita o prompt, um deploy junta
 * ferramentas) com conversas a meio. Com isto a API larga os que já não batem em
 * vez de recusar o pedido.
 */
const THINKING_BINDING_BETA = "thinking-binding-controls-2026-08-01";
const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** O Haiku não tem modelo de reserva do lado da API: uma recusa dele é final. */
const hasServerFallback = (model: string) => !model.startsWith("claude-haiku-");

/** A parte do SDK de que este cliente precisa (os testes dão-lhe uma falsa). */
export interface AnthropicMessagesApi {
  /** Com `onText`, pede em streaming e entrega o texto à medida que chega. */
  create(
    params: CreateParams,
    onText?: (delta: string) => void,
  ): Promise<{
    content: unknown[];
    stop_reason: string | null;
    /** O que a API mudou no que recebeu (raciocínio antigo que largou). */
    input_transformations?: unknown[] | null;
  }>;
}

export interface AnthropicLlmOptions {
  model: string;
  effort: Effort;
}

export const DEFAULT_ANTHROPIC_OPTIONS: AnthropicLlmOptions = {
  model: "claude-opus-5-5",
  effort: "medium",
};

/** O Claude, pela API da Anthropic, atrás da interface `LlmClient`. */
export class AnthropicLlmClient implements LlmClient {
  constructor(
    private readonly api: AnthropicMessagesApi,
    private readonly options: AnthropicLlmOptions = DEFAULT_ANTHROPIC_OPTIONS,
    private readonly log: (message: string) => void = () => undefined,
  ) {}

  /** Com as credenciais do ambiente (`ANTHROPIC_API_KEY`), lidas só no primeiro pedido. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): AnthropicLlmClient {
    let client: Anthropic | undefined;
    return new AnthropicLlmClient(
      {
        create: (params, onText) => {
          client ??= new Anthropic();
          if (!onText) return client.beta.messages.create(params);
          return client.beta.messages.stream(params).on("text", onText).finalMessage();
        },
      },
      {
        model: env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_OPTIONS.model,
        effort: (env.ANTHROPIC_EFFORT as Effort) || DEFAULT_ANTHROPIC_OPTIONS.effort,
      },
      (message) => console.warn(message),
    );
  }

  async respond(request: LlmRequest): Promise<LlmResponse> {
    const model = request.model ?? this.options.model;
    const fallback = hasServerFallback(model);
    const response = await this.api
      .create(
        {
          model,
          max_tokens: 16000,
          thinking: {
            type: "adaptive",
            block_binding: { prefix_mismatch_behavior: "drop_block" },
          },
          output_config: { effort: request.effort ?? this.options.effort },
          betas: [THINKING_BINDING_BETA, ...(fallback ? [SERVER_FALLBACK_BETA] : [])],
          // Se o modelo recusar por política, a API tenta de novo num modelo de reserva.
          ...(fallback ? { fallbacks: "default" as const } : {}),
          // O prompt e as ferramentas repetem-se a cada volta: ficam em cache.
          cache_control: { type: "ephemeral" },
          system: request.system,
          tools: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema,
          })),
          // Os blocos voltam como vieram (raciocínio incluído): o modelo exige-os intactos.
          messages: request.messages as unknown as Anthropic.Beta.Messages.BetaMessageParam[],
        },
        request.onText,
      )
      .catch((error: unknown) => {
        // Um pedido que a API dá por inválido (o histórico, um ficheiro que já não existe ou
        // é grande demais) não se resolve a repetir: quem chama decide o que fazer à conversa.
        // O pormenor fica no registo; quem pediu não o vê.
        if (
          error instanceof Anthropic.BadRequestError ||
          error instanceof Anthropic.NotFoundError ||
          error instanceof Anthropic.ContentTooLargeError
        ) {
          this.log(`Modelo ${model}: a API recusou o pedido: ${error.message}`);
          throw new AppError("O modelo recusou o pedido.", 502, "LLM_BAD_REQUEST");
        }
        throw error;
      });

    const dropped = response.input_transformations ?? [];
    if (dropped.length > 0) {
      const reasons = [
        ...new Set(dropped.map((t) => String((t as { reason?: unknown })?.reason ?? "?"))),
      ];
      this.log(
        `Modelo ${model}: a API largou ${dropped.length} bloco(s) de raciocínio antigo (${reasons.join(", ")}).`,
      );
    }
    return { content: response.content as ContentBlock[], stopReason: response.stop_reason };
  }
}
