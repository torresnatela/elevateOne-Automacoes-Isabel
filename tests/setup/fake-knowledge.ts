import { randomUUID } from "node:crypto";
import type { SourceFile, TextExtractor } from "@/server/integrations/documents/text-extractor";
import type { Embedder } from "@/server/integrations/openai/openai-embedder";
import {
  EMBEDDING_DIMENSIONS,
  type KnowledgeDocument,
  type KnowledgeHit,
  type NewKnowledgeChunk,
  type NewKnowledgeDocument,
} from "@/server/models/knowledge.model";
import type { AgentSettingRepository } from "@/server/repositories/agent-setting.repository";
import type { KnowledgeRepository } from "@/server/repositories/knowledge.repository";

/** Um vetor do tamanho certo, com `values` nas primeiras posições e zeros no resto. */
export const vector = (...values: number[]) =>
  Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => values[i] ?? 0);

const cosine = (a: number[], b: number[]) => {
  const dot = a.reduce((sum, x, i) => sum + x * b[i], 0);
  const norm = (v: number[]) => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  return dot / (norm(a) * norm(b) || 1);
};

/** Base de conhecimento em memória, com a mesma procura por cosseno. */
export class FakeKnowledgeRepository implements KnowledgeRepository {
  documents: KnowledgeDocument[] = [];
  chunks: Array<NewKnowledgeChunk & { documentId: string }> = [];

  async createDocument(doc: NewKnowledgeDocument, chunks: NewKnowledgeChunk[]) {
    const document: KnowledgeDocument = {
      id: randomUUID(),
      title: doc.title,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      size: doc.size,
      chunkCount: chunks.length,
      uploadedById: doc.uploadedById ?? null,
      createdAt: new Date(),
    };
    this.documents.unshift(document);
    this.chunks.push(...chunks.map((c) => ({ ...c, documentId: document.id })));
    return document;
  }

  async listDocuments() {
    return [...this.documents];
  }

  async deleteDocument(id: string) {
    const before = this.documents.length;
    this.documents = this.documents.filter((d) => d.id !== id);
    this.chunks = this.chunks.filter((c) => c.documentId !== id);
    return this.documents.length < before;
  }

  async search(embedding: number[], limit: number): Promise<KnowledgeHit[]> {
    return this.chunks
      .map((c) => ({
        content: c.content,
        documentId: c.documentId,
        documentTitle: this.documents.find((d) => d.id === c.documentId)!.title,
        score: cosine(embedding, c.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

/** Devolve o texto que lhe derem, sem ler o ficheiro. */
export class FakeTextExtractor implements TextExtractor {
  constructor(public text: string) {}
  async extract(_file: SourceFile) {
    return this.text;
  }
}

/**
 * Vetores previsíveis: cada texto fica no eixo da primeira palavra-chave que tiver
 * (os textos sem nenhuma ficam num eixo à parte).
 */
export class FakeEmbedder implements Embedder {
  calls: string[][] = [];
  constructor(private readonly keywords: string[]) {}

  async embed(texts: string[]) {
    this.calls.push(texts);
    return texts.map((text) => {
      const axis = this.keywords.findIndex((k) => text.toLowerCase().includes(k));
      const values = Array.from({ length: this.keywords.length + 1 }, () => 0);
      values[axis === -1 ? this.keywords.length : axis] = 1;
      return vector(...values);
    });
  }
}

export class FakeAgentSettingRepository implements AgentSettingRepository {
  prompts = new Map<string, string>();
  async getPrompt(agentId: string) {
    return this.prompts.get(agentId) ?? null;
  }
  async setPrompt(agentId: string, prompt: string) {
    this.prompts.set(agentId, prompt);
  }
  async clearPrompt(agentId: string) {
    this.prompts.delete(agentId);
  }
}
