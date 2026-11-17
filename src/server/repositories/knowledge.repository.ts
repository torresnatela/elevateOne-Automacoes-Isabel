import { randomUUID } from "node:crypto";
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
  /** Os pedaços mais parecidos com o vetor, do mais para o menos parecido. */
  search(embedding: number[], limit: number): Promise<KnowledgeHit[]>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O vetor como o pgvector o lê: `[0.1,0.2,…]`. */
const toVector = (embedding: number[]) => `[${embedding.join(",")}]`;

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
        // A coluna `vector` não existe no cliente do Prisma: os pedaços entram por SQL.
        for (const [position, chunk] of chunks.entries()) {
          await tx.$executeRaw`
            INSERT INTO "knowledge_chunks" ("id", "document_id", "position", "content", "embedding")
            VALUES (${randomUUID()}::uuid, ${row.id}::uuid, ${position}, ${chunk.content},
                    ${toVector(chunk.embedding)}::vector)`;
        }
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

  async search(embedding: number[], limit: number) {
    const vector = toVector(embedding);
    const rows = await this.db.$queryRaw<KnowledgeHit[]>`
      SELECT c."content", c."document_id" AS "documentId", d."title" AS "documentTitle",
             (1 - (c."embedding" <=> ${vector}::vector))::float8 AS "score"
      FROM "knowledge_chunks" c
      JOIN "knowledge_documents" d ON d."id" = c."document_id"
      ORDER BY c."embedding" <=> ${vector}::vector
      LIMIT ${limit}`;
    return rows;
  }
}
