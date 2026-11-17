import type { ToolContext } from "@/server/agents/core/types";
import { searchKnowledgeTool } from "@/server/agents/tools/search-knowledge.tool";

const ctx: ToolContext = { agentId: "a", conversationId: "c", channel: "WEB", userId: "u" };

describe("buscar_conhecimento", () => {
  it("devolve os excertos com o documento de origem", async () => {
    const search = vi.fn(async () => [
      {
        content: "O IVA normal é 23 %.",
        documentId: "d1",
        documentTitle: "Guia do IVA",
        score: 0.8,
      },
    ]);
    const tool = searchKnowledgeTool({ search });

    await expect(tool.execute(ctx, { pergunta: "taxa de IVA" })).resolves.toEqual({
      encontrado: true,
      excertos: [{ documento: "Guia do IVA", texto: "O IVA normal é 23 %." }],
    });
    expect(search).toHaveBeenCalledWith("taxa de IVA");
  });

  it("diz claramente quando a base não tem nada", async () => {
    const tool = searchKnowledgeTool({ search: async () => [] });
    await expect(tool.execute(ctx, { pergunta: "bolos" })).resolves.toMatchObject({
      encontrado: false,
    });
  });

  it("só lê: não exige confirmação, e recusa uma pergunta vazia", () => {
    const tool = searchKnowledgeTool({ search: async () => [] });
    expect(tool.requiresConfirmation).toBe(false);
    expect(tool.schema.safeParse({ pergunta: "" }).success).toBe(false);
  });
});
