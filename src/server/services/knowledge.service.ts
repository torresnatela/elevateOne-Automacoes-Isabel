import type { SourceFile, TextExtractor } from "@/server/integrations/documents/text-extractor";
import type { Embedder } from "@/server/integrations/openai/openai-embedder";
import { chunkText } from "@/server/lib/chunk";
import { AppError } from "@/server/lib/errors";
import {
  EMBEDDING_DIMENSIONS,
  type KnowledgeDocument,
  type KnowledgeHit,
} from "@/server/models/knowledge.model";
import type { KnowledgeRepository } from "@/server/repositories/knowledge.repository";

/** O maior ficheiro que se aceita (bytes). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface IngestInput extends SourceFile {
  /** O nome que a equipa vê; sem ele, o do ficheiro sem a extensão. */
  title?: string;
  uploadedById?: string | null;
}

export interface SearchOptions {
  /** Quantos pedaços, no máximo. */
  limit?: number;
  /** Abaixo desta semelhança (0 a 1), um pedaço não conta como resposta. */
  minScore?: number;
}

/** A base de conhecimento: recebe ficheiros, parte-os em pedaços e procura por sentido. */
export class KnowledgeService {
  constructor(
    private readonly repository: KnowledgeRepository,
    private readonly extractor: TextExtractor,
    private readonly embedder: Embedder,
  ) {}

  async ingest(input: IngestInput): Promise<KnowledgeDocument> {
    if (input.data.byteLength === 0)
      throw new AppError("O ficheiro está vazio.", 400, "EMPTY_FILE");
    if (input.data.byteLength > MAX_FILE_BYTES)
      throw new AppError("O ficheiro é grande demais (máximo 25 MB).", 413, "FILE_TOO_LARGE");

    const chunks = chunkText(await this.extractor.extract(input));
    if (chunks.length === 0)
      throw new AppError(
        "Não foi possível ler texto neste ficheiro. Se for um PDF digitalizado, é preciso uma versão com texto.",
        422,
        "NO_TEXT_FOUND",
      );

    const embeddings = await this.embed(chunks);
    return this.repository.createDocument(
      {
        title: input.title?.trim() || input.fileName.replace(/\.[^.]+$/, ""),
        fileName: input.fileName,
        mimeType: input.mimeType,
        size: input.data.byteLength,
        uploadedById: input.uploadedById ?? null,
      },
      chunks.map((content, i) => ({ content, embedding: embeddings[i] })),
    );
  }

  list(): Promise<KnowledgeDocument[]> {
    return this.repository.listDocuments();
  }

  async remove(id: string): Promise<void> {
    if (!(await this.repository.deleteDocument(id)))
      throw new AppError("Ficheiro não encontrado.", 404, "DOCUMENT_NOT_FOUND");
  }

  async search(query: string, options: SearchOptions = {}): Promise<KnowledgeHit[]> {
    const { limit = 6, minScore = 0.25 } = options;
    if (!query.trim()) return [];
    const [embedding] = await this.embed([query]);
    const hits = await this.repository.search(embedding, limit);
    return hits.filter((hit) => hit.score >= minScore);
  }

  private async embed(texts: string[]): Promise<number[][]> {
    const vectors = await this.embedder.embed(texts);
    for (const vector of vectors) {
      if (vector.length !== EMBEDDING_DIMENSIONS || !vector.every(Number.isFinite))
        throw new Error(`Vetor inválido: esperavam-se ${EMBEDDING_DIMENSIONS} números.`);
    }
    return vectors;
  }
}
