import { PrismaAgentSettingRepository } from "@/server/repositories/agent-setting.repository";
import { PrismaKnowledgeRepository } from "@/server/repositories/knowledge.repository";
import { prisma, resetDatabase } from "../setup/db";
import { vector } from "../setup/fake-knowledge";

const repo = new PrismaKnowledgeRepository(prisma);
const doc = (title: string) => ({
  title,
  fileName: `${title}.pdf`,
  mimeType: "application/pdf",
  size: 10,
});

describe("PrismaKnowledgeRepository (pgvector)", () => {
  beforeEach(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it("guarda o ficheiro com os pedaços e lista do mais recente para o mais antigo", async () => {
    const first = await repo.createDocument(doc("IVA"), [
      { content: "a", embedding: vector(1) },
      { content: "b", embedding: vector(0, 1) },
    ]);
    await repo.createDocument(doc("IRS"), [{ content: "c", embedding: vector(0, 0, 1) }]);

    expect(first).toMatchObject({ title: "IVA", chunkCount: 2, uploadedById: null });
    const listed = await repo.listDocuments();
    expect(listed.map((d) => d.title)).toEqual(["IRS", "IVA"]);
    await expect(prisma.knowledgeChunk.count()).resolves.toBe(3);
  });

  it("procura por semelhança, do mais para o menos parecido, com o ficheiro de origem", async () => {
    const iva = await repo.createDocument(doc("IVA"), [
      { content: "taxa normal", embedding: vector(1, 0) },
      { content: "taxa reduzida", embedding: vector(0.8, 0.6) },
    ]);
    await repo.createDocument(doc("IRS"), [{ content: "prazo", embedding: vector(0, 1) }]);

    const hits = await repo.search(vector(1, 0), 2);

    expect(hits.map((h) => h.content)).toEqual(["taxa normal", "taxa reduzida"]);
    expect(hits[0]).toMatchObject({ documentId: iva.id, documentTitle: "IVA" });
    expect(hits[0].score).toBeCloseTo(1, 5);
    expect(hits[1].score).toBeCloseTo(0.8, 5);
  });

  it("apagar o ficheiro apaga os pedaços", async () => {
    const created = await repo.createDocument(doc("IVA"), [{ content: "a", embedding: vector(1) }]);

    await expect(repo.deleteDocument(created.id)).resolves.toBe(true);
    await expect(prisma.knowledgeChunk.count()).resolves.toBe(0);
    await expect(repo.deleteDocument(created.id)).resolves.toBe(false);
    await expect(repo.deleteDocument("nao-e-uuid")).resolves.toBe(false);
  });

  it("não guarda o ficheiro se um pedaço falhar", async () => {
    await expect(
      repo.createDocument(doc("IVA"), [{ content: "a", embedding: [1, 2, 3] }]),
    ).rejects.toThrow();
    await expect(repo.listDocuments()).resolves.toEqual([]);
  });
});

describe("PrismaAgentSettingRepository", () => {
  const settings = new PrismaAgentSettingRepository(prisma);
  beforeEach(resetDatabase);

  it("guarda, substitui e limpa as instruções de um agente", async () => {
    await expect(settings.getPrompt("assistente")).resolves.toBeNull();
    await settings.setPrompt("assistente", "um");
    await settings.setPrompt("assistente", "dois");
    await expect(settings.getPrompt("assistente")).resolves.toBe("dois");
    await settings.clearPrompt("assistente");
    await settings.clearPrompt("assistente");
    await expect(settings.getPrompt("assistente")).resolves.toBeNull();
  });
});
