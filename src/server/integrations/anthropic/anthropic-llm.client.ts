import Anthropic from "@anthropic-ai/sdk";
import type { LlmClient, LlmRequest, LlmResponse } from "@/server/agents/core/types";
import type { ContentBlock } from "@/server/models/conversation.model";

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Effort = NonNullable<NonNullable<CreateParams["output_config"]>["effort"]>;

/** A parte do SDK de que este cliente precisa (os testes dão-lhe uma falsa). */
export interface AnthropicMessagesApi {
  /** Com `onText`, pede em streaming e entrega o texto à medida que chega. */
  create(
    params: CreateParams,
    onText?: (delta: string) => void,
  ): Promise<{ content: unknown[]; stop_reason: string | null }>;
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
    );
  }

  async respond(request: LlmRequest): Promise<LlmResponse> {
    const response = await this.api.create(
      {
        model: this.options.model,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { effort: this.options.effort },
        // Se o modelo recusar por política, a API tenta de novo num modelo de reserva.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
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
    );
    return { content: response.content as ContentBlock[], stopReason: response.stop_reason };
  }
}
