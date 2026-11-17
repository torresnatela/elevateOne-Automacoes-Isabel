import OpenAI from "openai";
import { AppError } from "@/server/lib/errors";

/** Transforma textos em vetores. A base de conhecimento depende desta interface. */
export interface Embedder {
  /** Um vetor por texto, pela mesma ordem. */
  embed(texts: string[]): Promise<number[][]>;
}

/** A parte do SDK de que o embedder precisa (os testes dão-lhe uma falsa). */
export interface OpenAIEmbeddingsApi {
  create(params: {
    model: string;
    input: string[];
  }): Promise<{ data: Array<{ index: number; embedding: number[] }> }>;
}

export const EMBEDDING_MODEL = "text-embedding-3-small";
/** Quantos textos vão em cada pedido. */
const BATCH = 96;

export class OpenAIEmbedder implements Embedder {
  constructor(
    private readonly api: OpenAIEmbeddingsApi,
    private readonly model: string = EMBEDDING_MODEL,
  ) {}

  /** Com a chave do ambiente (`OPENAI_API_KEY`), lida só no primeiro pedido. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): OpenAIEmbedder {
    let client: OpenAI | undefined;
    return new OpenAIEmbedder({
      create: (params) => {
        if (!env.OPENAI_API_KEY)
          throw new AppError(
            "A base de conhecimento não está configurada (falta a OPENAI_API_KEY).",
            503,
            "EMBEDDINGS_NOT_CONFIGURED",
          );
        client ??= new OpenAI({ apiKey: env.OPENAI_API_KEY });
        return client.embeddings.create({ ...params, encoding_format: "float" });
      },
    });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const input = texts.slice(i, i + BATCH);
      const { data } = await this.api.create({ model: this.model, input });
      const ordered = [...data].sort((a, b) => a.index - b.index);
      if (ordered.length !== input.length)
        throw new Error("O fornecedor devolveu vetores a menos.");
      vectors.push(...ordered.map((d) => d.embedding));
    }
    return vectors;
  }
}
