import { randomUUID } from "node:crypto";
import type { SourceFile, TextExtractor } from "@/server/integrations/documents/text-extractor";
import type {
  KnowledgeDocument,
  KnowledgeHit,
  NewKnowledgeChunk,
  NewKnowledgeDocument,
} from "@/server/models/knowledge.model";
import type { AgentSettingRepository } from "@/server/repositories/agent-setting.repository";
import type { KnowledgeRepository } from "@/server/repositories/knowledge.repository";

const STOPWORDS = new Set([
  "qual",
  "como",
  "quando",
  "para",
  "por",
  "com",
  "sem",
  "uma",
  "que",
  "dos",
  "das",
]);

/** Uma imitação grosseira do texto completo do Postgres: minúsculas, sem acentos, sem plural. */
const terms = (text: string) =>
  new Set(
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
      .map((w) => w.replace(/s$/, "")),
  );

/** Base de conhecimento em memória, com uma procura por termos parecida com a do Postgres. */
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

  queries: string[] = [];

  async search(query: string, limit: number): Promise<KnowledgeHit[]> {
    this.queries.push(query);
    const wanted = terms(query);
    return this.chunks
      .map((c) => {
        const found = [...terms(c.content)].filter((t) => wanted.has(t)).length;
        return {
          content: c.content,
          documentId: c.documentId,
          documentTitle: this.documents.find((d) => d.id === c.documentId)!.title,
          score: found / (found + 1),
        };
      })
      .filter((hit) => hit.score > 0)
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
