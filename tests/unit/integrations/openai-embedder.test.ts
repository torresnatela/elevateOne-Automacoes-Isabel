import {
  OpenAIEmbedder,
  type OpenAIEmbeddingsApi,
} from "@/server/integrations/openai/openai-embedder";

describe("OpenAIEmbedder", () => {
  it("devolve um vetor por texto, pela ordem dos textos", async () => {
    const create = vi.fn<OpenAIEmbeddingsApi["create"]>(async ({ input }) => ({
      // Fora de ordem, como a API pode devolver.
      data: input.map((text, index) => ({ index, embedding: [text.length] })).reverse(),
    }));
    const vectors = await new OpenAIEmbedder({ create }).embed(["a", "bbb", "cc"]);

    expect(vectors).toEqual([[1], [3], [2]]);
    expect(create).toHaveBeenCalledWith({
      model: "text-embedding-3-small",
      input: ["a", "bbb", "cc"],
    });
  });

  it("parte muitos textos em vários pedidos", async () => {
    const create = vi.fn<OpenAIEmbeddingsApi["create"]>(async ({ input }) => ({
      data: input.map((_, index) => ({ index, embedding: [0] })),
    }));
    const vectors = await new OpenAIEmbedder({ create }).embed(
      Array.from({ length: 200 }, () => "x"),
    );

    expect(vectors).toHaveLength(200);
    expect(create.mock.calls.map(([p]) => p.input.length)).toEqual([96, 96, 8]);
  });

  it("falha se vierem vetores a menos", async () => {
    const create = vi.fn<OpenAIEmbeddingsApi["create"]>(async () => ({ data: [] }));
    await expect(new OpenAIEmbedder({ create }).embed(["a"])).rejects.toThrow(/a menos/);
  });

  it("avisa que falta a chave, sem chamar a API", async () => {
    await expect(
      OpenAIEmbedder.fromEnv({} as NodeJS.ProcessEnv).embed(["a"]),
    ).rejects.toMatchObject({
      status: 503,
      code: "EMBEDDINGS_NOT_CONFIGURED",
    });
  });
});
