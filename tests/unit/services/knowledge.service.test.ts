import { KnowledgeService, MAX_FILE_BYTES } from "@/server/services/knowledge.service";
import { FakeKnowledgeRepository, FakeTextExtractor } from "../../setup/fake-knowledge";

const file = (fileName = "guia-iva.pdf") => ({
  fileName,
  mimeType: "application/pdf",
  data: new Uint8Array([1, 2, 3]),
});

function setup(text = "O IVA normal é 23 %.") {
  const repository = new FakeKnowledgeRepository();
  const extractor = new FakeTextExtractor(text);
  return {
    repository,
    extractor,
    service: new KnowledgeService(repository, extractor),
  };
}

describe("KnowledgeService.ingest", () => {
  it("guarda o ficheiro com os pedaços", async () => {
    const t = setup();
    const doc = await t.service.ingest({ ...file(), uploadedById: "u1" });

    expect(doc).toMatchObject({
      title: "guia-iva",
      fileName: "guia-iva.pdf",
      size: 3,
      chunkCount: 1,
      uploadedById: "u1",
    });
    expect(t.repository.chunks).toHaveLength(1);
    expect(t.repository.chunks[0].content).toBe("O IVA normal é 23 %.");
  });

  it("usa o título dado, quando há", async () => {
    const t = setup();
    const doc = await t.service.ingest({ ...file(), title: "  Guia do IVA  " });
    expect(doc.title).toBe("Guia do IVA");
  });

  it("parte um texto longo em vários pedaços", async () => {
    const t = setup(
      Array.from({ length: 60 }, (_, i) => `Parágrafo ${i} sobre o IVA.`).join("\n\n"),
    );
    const doc = await t.service.ingest(file());
    expect(doc.chunkCount).toBeGreaterThan(1);
    expect(t.repository.chunks).toHaveLength(doc.chunkCount);
  });

  it("recusa um ficheiro sem texto (um PDF digitalizado)", async () => {
    const t = setup("   ");
    await expect(t.service.ingest(file())).rejects.toMatchObject({
      status: 422,
      code: "NO_TEXT_FOUND",
    });
    expect(t.repository.documents).toEqual([]);
  });

  it("recusa um ficheiro vazio ou grande demais, sem o ler", async () => {
    const t = setup();
    await expect(t.service.ingest({ ...file(), data: new Uint8Array() })).rejects.toMatchObject({
      code: "EMPTY_FILE",
    });
    await expect(
      t.service.ingest({ ...file(), data: new Uint8Array(MAX_FILE_BYTES + 1) }),
    ).rejects.toMatchObject({ status: 413, code: "FILE_TOO_LARGE" });
  });
});

describe("KnowledgeService.search", () => {
  async function withTwoDocs() {
    const t = setup();
    await t.service.ingest({ ...file("iva.pdf"), title: "Guia do IVA" });
    t.extractor.text = "O prazo do IRS é em junho.";
    await t.service.ingest({ ...file("irs.pdf"), title: "Guia do IRS" });
    return t;
  }

  it("devolve os pedaços com os termos da pergunta, com o ficheiro de origem", async () => {
    const t = await withTwoDocs();
    const hits = await t.service.search("prazos IRS");

    expect(t.repository.queries).toEqual(["prazos IRS"]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      documentTitle: "Guia do IRS",
      content: "O prazo do IRS é em junho.",
    });
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it("deixa de fora os pedaços abaixo da relevância mínima", async () => {
    const t = await withTwoDocs();
    await expect(t.service.search("prazo IRS", { minScore: 0.99 })).resolves.toEqual([]);
  });

  it("não devolve nada quando a base não cobre a pergunta", async () => {
    const t = await withTwoDocs();
    await expect(t.service.search("Como faço um bolo?")).resolves.toEqual([]);
  });

  it("não procura uma pergunta vazia", async () => {
    const t = setup();
    await expect(t.service.search("  ")).resolves.toEqual([]);
    expect(t.repository.queries).toEqual([]);
  });
});

describe("KnowledgeService.remove", () => {
  it("apaga o ficheiro e os pedaços", async () => {
    const t = setup();
    const doc = await t.service.ingest(file());
    await t.service.remove(doc.id);
    await expect(t.service.list()).resolves.toEqual([]);
    expect(t.repository.chunks).toEqual([]);
  });

  it("responde 404 a um ficheiro que não existe", async () => {
    await expect(setup().service.remove("x")).rejects.toMatchObject({ status: 404 });
  });
});
