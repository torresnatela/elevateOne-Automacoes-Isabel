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
        thinking: { type: "adaptive" },
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
    expect(params.thinking).toEqual({ type: "adaptive" });
  });
});
