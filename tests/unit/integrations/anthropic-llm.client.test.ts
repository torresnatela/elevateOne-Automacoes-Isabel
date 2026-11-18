import Anthropic from "@anthropic-ai/sdk";
import {
  AnthropicLlmClient,
  type AnthropicMessagesApi,
} from "@/server/integrations/anthropic/anthropic-llm.client";

describe("AnthropicLlmClient", () => {
  it("envia o pedido no formato da API e devolve os blocos sem mexer", async () => {
    const content = [
      { type: "thinking", thinking: "", signature: "s" },
      { type: "tool_use", id: "t1", name: "procurar", input: { q: "IVA" } },
    ];
    const create = vi.fn<AnthropicMessagesApi["create"]>(async () => ({
      content,
      stop_reason: "tool_use",
    }));
    const client = new AnthropicLlmClient({ create }, { model: "claude-opus-5-5", effort: "low" });

    const response = await client.respond({
      system: "És o assistente.",
      messages: [{ role: "user", content: [{ type: "text", text: "Olá" }] }],
      tools: [
        {
          name: "procurar",
          description: "Procura.",
          inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
        },
      ],
    });

    expect(response).toEqual({ content, stopReason: "tool_use" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-opus-5-5",
        system: "És o assistente.",
        thinking: {
          type: "adaptive",
          block_binding: { prefix_mismatch_behavior: "drop_block" },
        },
        output_config: { effort: "low" },
        messages: [{ role: "user", content: [{ type: "text", text: "Olá" }] }],
        tools: [
          {
            name: "procurar",
            description: "Procura.",
            input_schema: {
              type: "object",
              properties: { q: { type: "string" } },
              required: ["q"],
            },
          },
        ],
      }),
      undefined,
    );
  });

  it("passa adiante o pedido de texto aos bocados", async () => {
    const create = vi.fn<AnthropicMessagesApi["create"]>(async (_params, onText) => {
      onText?.("Olá");
      return { content: [{ type: "text", text: "Olá" }], stop_reason: "end_turn" };
    });
    const seen: string[] = [];
    await new AnthropicLlmClient({ create }).respond({
      system: "s",
      messages: [],
      tools: [],
      onText: (delta) => seen.push(delta),
    });
    expect(seen).toEqual(["Olá"]);
  });

  it("não força a escolha de ferramenta nem desliga o raciocínio (o modelo recusa-os)", async () => {
    const create = vi.fn<AnthropicMessagesApi["create"]>(async () => ({
      content: [],
      stop_reason: "end_turn",
    }));
    await new AnthropicLlmClient({ create }).respond({ system: "s", messages: [], tools: [] });

    const params = create.mock.calls[0][0];
    expect(params.tool_choice).toBeUndefined();
    expect(params.thinking).toMatchObject({ type: "adaptive" });
  });

  const answering = () =>
    vi.fn<AnthropicMessagesApi["create"]>(async () => ({ content: [], stop_reason: "end_turn" }));
  const ask = { system: "s", messages: [], tools: [] };

  it("usa o modelo e o esforço do pedido, quando o agente os fixa", async () => {
    const create = answering();
    await new AnthropicLlmClient({ create }, { model: "claude-opus-5-5", effort: "low" }).respond({
      ...ask,
      model: "claude-haiku-5-5",
      effort: "high",
    });

    const params = create.mock.calls[0][0];
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params.output_config).toEqual({ effort: "high" });
  });

  it("sem modelo no pedido, vale o de origem", async () => {
    const create = answering();
    await new AnthropicLlmClient({ create }, { model: "claude-opus-5-5", effort: "low" }).respond(
      ask,
    );

    const params = create.mock.calls[0][0];
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.output_config).toEqual({ effort: "low" });
  });

  it("ao Haiku não pede o modelo de reserva: não o tem", async () => {
    const create = answering();
    await new AnthropicLlmClient({ create }).respond({ ...ask, model: "claude-haiku-5-5" });

    const params = create.mock.calls[0][0];
    expect(params.fallbacks).toBeUndefined();
    expect(params.betas).toEqual(["thinking-binding-controls-2026-08-01"]);
  });

  it("aos outros modelos continua a pedir o modelo de reserva", async () => {
    const create = answering();
    await new AnthropicLlmClient({ create }).respond({ ...ask, model: "claude-opus-5-5" });

    const params = create.mock.calls[0][0];
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toEqual([
      "thinking-binding-controls-2026-08-01",
      "server-side-fallback-2026-07-01",
    ]);
  });

  it("pede para largar o raciocínio antigo que já não bate com a conversa, em vez de falhar", async () => {
    const create = answering();
    await new AnthropicLlmClient({ create }).respond({ ...ask, model: "claude-haiku-5-5" });

    expect(create.mock.calls[0][0].thinking).toEqual({
      type: "adaptive",
      block_binding: { prefix_mismatch_behavior: "drop_block" },
    });
  });

  it("avisa quando a API largou raciocínio antigo", async () => {
    const create = vi.fn<AnthropicMessagesApi["create"]>(async () => ({
      content: [],
      stop_reason: "end_turn",
      input_transformations: [
        { type: "thinking_dropped", reason: "prefix_binding_mismatch" },
        { type: "thinking_dropped", reason: "prefix_binding_mismatch" },
      ],
    }));
    const warnings: string[] = [];
    await new AnthropicLlmClient({ create }, undefined, (m) => warnings.push(m)).respond(ask);

    expect(warnings).toEqual([expect.stringContaining("2")]);
    expect(warnings[0]).toContain("prefix_binding_mismatch");
  });

  it("um pedido que a API dá por inválido sai como LLM_BAD_REQUEST, sem pormenores para quem pediu", async () => {
    const create = vi.fn<AnthropicMessagesApi["create"]>(async () => {
      throw new Anthropic.BadRequestError(400, undefined, "messages.3: inválido", new Headers());
    });
    const logs: string[] = [];

    const error = await new AnthropicLlmClient({ create }, undefined, (m) => logs.push(m))
      .respond(ask)
      .catch((e) => e);

    expect(error).toMatchObject({ code: "LLM_BAD_REQUEST", status: 502 });
    expect(error.message).toBe("O modelo recusou o pedido.");
    expect(logs.join()).toContain("messages.3: inválido");
  });

  it("um ficheiro que já não existe, ou grande demais, também é um pedido que não vale a pena repetir", async () => {
    for (const failure of [
      new Anthropic.NotFoundError(404, undefined, "File not found", new Headers()),
      new Anthropic.ContentTooLargeError(413, undefined, "Request too large", new Headers()),
    ]) {
      const create = vi.fn<AnthropicMessagesApi["create"]>(async () => {
        throw failure;
      });
      await expect(new AnthropicLlmClient({ create }).respond(ask)).rejects.toMatchObject({
        code: "LLM_BAD_REQUEST",
      });
    }
  });

  it("uma falha passageira da API passa como veio", async () => {
    const create = vi.fn<AnthropicMessagesApi["create"]>(async () => {
      throw new Anthropic.RateLimitError(429, undefined, "devagar", new Headers());
    });
    await expect(new AnthropicLlmClient({ create }).respond(ask)).rejects.toBeInstanceOf(
      Anthropic.RateLimitError,
    );
  });
});
