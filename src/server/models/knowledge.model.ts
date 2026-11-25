/** Models de domínio da base de conhecimento. Independentes do Prisma. */

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
}

/** Um pedaço encontrado numa procura. */
export interface KnowledgeHit {
  content: string;
  documentId: string;
  documentTitle: string;
  /** Relevância para a pergunta, de 0 a 1 (mais termos da pergunta, mais perto uns dos outros, mais alto). */
  score: number;
}
