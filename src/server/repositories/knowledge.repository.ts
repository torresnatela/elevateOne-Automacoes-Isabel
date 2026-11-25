import type { PrismaClient } from "@prisma/client";
import type {
  KnowledgeDocument,
  KnowledgeHit,
  NewKnowledgeChunk,
  NewKnowledgeDocument,
} from "@/server/models/knowledge.model";

/** Contrato de persistência da base de conhecimento. */
export interface KnowledgeRepository {
  /** Guarda o ficheiro e os seus pedaços, tudo ou nada. */
  createDocument(
    doc: NewKnowledgeDocument,
    chunks: NewKnowledgeChunk[],
  ): Promise<KnowledgeDocument>;
  /** Os ficheiros, do mais recente para o mais antigo. */
  listDocuments(): Promise<KnowledgeDocument[]>;
  /** Apaga o ficheiro e os pedaços. `false` se não existia. */
  deleteDocument(id: string): Promise<boolean>;
  /**
   * Os pedaços que têm algum dos termos da pergunta, do mais para o menos relevante.
   * Procura por texto completo (português, sem acentos): "faturas" encontra "fatura".
   */
  search(query: string, limit: number): Promise<KnowledgeHit[]>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PrismaKnowledgeRepository implements KnowledgeRepository {
  constructor(private readonly db: PrismaClient) {}

  async createDocument(doc: NewKnowledgeDocument, chunks: NewKnowledgeChunk[]) {
    return this.db.$transaction(
      async (tx) => {
        const row = await tx.knowledgeDocument.create({
          data: {
            title: doc.title,
            fileName: doc.fileName,
            mimeType: doc.mimeType,
            size: doc.size,
            chunkCount: chunks.length,
            uploadedById: doc.uploadedById ?? null,
          },
        });
        // O `search_vector` é gerado pelo Postgres a partir do conteúdo.
        await tx.knowledgeChunk.createMany({
          data: chunks.map((chunk, position) => ({
            documentId: row.id,
            position,
            content: chunk.content,
          })),
        });
        return row;
      },
      { timeout: 120_000 },
    );
  }

  async listDocuments() {
    return this.db.knowledgeDocument.findMany({ orderBy: { createdAt: "desc" } });
  }

  async deleteDocument(id: string) {
    if (!UUID_RE.test(id)) return false;
    const { count } = await this.db.knowledgeDocument.deleteMany({ where: { id } });
    return count > 0;
  }

  async search(query: string, limit: number) {
    // Os termos da pergunta ligados por OU (o `plainto_tsquery` liga-os por E): basta um
    // termo para o pedaço aparecer, e quantos mais tiver, mais acima fica.
    // `ts_rank_cd(..., 32)` devolve rank / (rank + 1), de 0 a 1.
    const rows = await this.db.$queryRaw<KnowledgeHit[]>`
      WITH q AS (
        SELECT replace(plainto_tsquery('portuguese', immutable_unaccent(${query}))::text, '&', '|')::tsquery AS terms
      )
      SELECT c."content", c."document_id" AS "documentId", d."title" AS "documentTitle",
             ts_rank_cd(c."search_vector", q.terms, 32)::float8 AS "score"
      FROM "knowledge_chunks" c
      JOIN "knowledge_documents" d ON d."id" = c."document_id"
      CROSS JOIN q
      WHERE c."search_vector" @@ q.terms
      ORDER BY "score" DESC, c."document_id", c."position"
      LIMIT ${limit}`;
    return rows;
  }
}
