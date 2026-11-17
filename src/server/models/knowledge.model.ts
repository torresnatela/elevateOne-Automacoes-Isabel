/** Models de domínio da base de conhecimento. Independentes do Prisma. */

/** O tamanho dos vetores (o do modelo de embeddings e o da coluna `vector`). */
export const EMBEDDING_DIMENSIONS = 1536;

export interface KnowledgeDocument {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  /** Em bytes. */
  size: number;
  chunkCount: number;
  uploadedById: string | null;
  createdAt: Date;
}

export interface NewKnowledgeDocument {
  title: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedById?: string | null;
}

export interface NewKnowledgeChunk {
  content: string;
  embedding: number[];
}

/** Um pedaço encontrado numa procura. */
export interface KnowledgeHit {
  content: string;
  documentId: string;
  documentTitle: string;
  /** Semelhança com a pergunta, de 0 a 1 (cosseno). */
  score: number;
}
