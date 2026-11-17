import type { LlmClient, LlmRequest, LlmResponse } from "@/server/agents/core/types";
import type { ContentBlock } from "@/server/models/conversation.model";

type Step = LlmResponse | Error | ((request: LlmRequest) => LlmResponse);

/** Um modelo de linguagem com as respostas escritas de antemão, uma por pedido. */
export class FakeLlmClient implements LlmClient {
  /** Os pedidos recebidos, cada um como estava quando chegou. */
  requests: LlmRequest[] = [];

  constructor(readonly script: Step[]) {}

  async respond(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(structuredClone({ ...request, onText: undefined }));
    const step = this.script.shift();
    if (!step) throw new Error("FakeLlmClient: não há mais respostas no guião");
    if (step instanceof Error) throw step;
    const response = typeof step === "function" ? step(request) : step;
    // Como o modelo a sério: o texto chega aos bocados, palavra a palavra.
    for (const block of response.content) {
      if (block.type === "text" && typeof block.text === "string")
        for (const piece of block.text.split(/(?<= )/)) request.onText?.(piece);
    }
    return response;
  }
}

export const says = (text: string): LlmResponse => ({
  content: [{ type: "text", text }],
  stopReason: "end_turn",
});

export const calls = (
  ...uses: Array<{ id: string; name: string; input: unknown }>
): LlmResponse => ({
  content: uses.map((u): ContentBlock => ({ type: "tool_use", ...u })),
  stopReason: "tool_use",
});
