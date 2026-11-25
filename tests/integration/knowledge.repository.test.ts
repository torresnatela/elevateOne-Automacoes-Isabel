import { PrismaAgentSettingRepository } from "@/server/repositories/agent-setting.repository";
import { PrismaKnowledgeRepository } from "@/server/repositories/knowledge.repository";
import { prisma, resetDatabase } from "../setup/db";

const repo = new PrismaKnowledgeRepository(prisma);
const doc = (title: string) => ({
  title,
  fileName: `${title}.pdf`,
  mimeType: "application/pdf",
  size: 10,
});

describe("PrismaKnowledgeRepository (texto completo)", () => {
  beforeEach(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it("guarda o ficheiro com os pedaços e lista do mais recente para o mais antigo", async () => {
    const first = await repo.createDocument(doc("IVA"), [{ content: "a" }, { content: "b" }]);
    await repo.createDocument(doc("IRS"), [{ content: "c" }]);

    expect(first).toMatchObject({ title: "IVA", chunkCount: 2, uploadedById: null });
    const listed = await repo.listDocuments();
    expect(listed.map((d) => d.title)).toEqual(["IRS", "IVA"]);
    await expect(prisma.knowledgeChunk.count()).resolves.toBe(3);
  });

  it("procura por termos, sem acentos nem plural, do mais para o menos relevante", async () => {
    const iva = await repo.createDocument(doc("IVA"), [
      { content: "A taxa normal do IVA é 23 %." },
      { content: "A taxa reduzida aplica-se a bens essenciais." },
      { content: "Sobre faturação eletrónica." },
    ]);
    await repo.createDocument(doc("IRS"), [{ content: "O prazo de entrega é em junho." }]);

    const hits = await repo.search("taxas iva", 5);

    expect(hits.map((h) => h.content)).toEqual([
      "A taxa normal do IVA é 23 %.",
      "A taxa reduzida aplica-se a bens essenciais.",
    ]);
    expect(hits[0]).toMatchObject({ documentId: iva.id, documentTitle: "IVA" });
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
    expect(hits[1].score).toBeGreaterThan(0);
    expect(hits[0].score).toBeLessThan(1);

    const semAcento = await repo.search("faturacao eletronica", 5);
    expect(semAcento.map((h) => h.content)).toEqual(["Sobre faturação eletrónica."]);
  });

  it("não devolve nada para uma pergunta sem termos úteis ou sem resultados", async () => {
    await repo.createDocument(doc("IVA"), [{ content: "A taxa normal do IVA é 23 %." }]);
    await expect(repo.search("o que é de", 5)).resolves.toEqual([]);
    await expect(repo.search("bolo de chocolate", 5)).resolves.toEqual([]);
    await expect(repo.search("taxa' | !(", 5)).resolves.toHaveLength(1);
  });

  it("apagar o ficheiro apaga os pedaços", async () => {
    const created = await repo.createDocument(doc("IVA"), [{ content: "a" }]);

    await expect(repo.deleteDocument(created.id)).resolves.toBe(true);
    await expect(prisma.knowledgeChunk.count()).resolves.toBe(0);
    await expect(repo.deleteDocument(created.id)).resolves.toBe(false);
    await expect(repo.deleteDocument("nao-e-uuid")).resolves.toBe(false);
  });

  it("não guarda o ficheiro se um pedaço falhar", async () => {
    await expect(
      // O Postgres não aceita o carácter nulo num texto.
      repo.createDocument(doc("IVA"), [{ content: "a" }, { content: "b\u0000" }]),
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
