import { readFileSync } from "node:fs";
import {
  fileKind,
  FileTextExtractor,
  pdfPageCount,
} from "@/server/integrations/documents/text-extractor";

const extractor = new FileTextExtractor();
const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/${name}`));

describe("fileKind", () => {
  it("reconhece pela extensão, mesmo com o tipo errado", () => {
    expect(fileKind("Guia.PDF", "application/octet-stream")).toBe("pdf");
    expect(fileKind("notas.md", "")).toBe("text");
    expect(fileKind("manual.docx", "application/zip")).toBe("docx");
  });

  it("reconhece pelo tipo quando não há extensão", () => {
    expect(fileKind("guia", "application/pdf")).toBe("pdf");
    expect(fileKind("notas", "text/plain; charset=utf-8")).toBe("text");
  });

  it("não reconhece o resto", () => {
    expect(fileKind("folha.xlsx", "application/vnd.ms-excel")).toBeNull();
    expect(fileKind("antigo.doc", "application/msword")).toBeNull();
  });
});

describe("FileTextExtractor", () => {
  it("lê texto simples em UTF-8", async () => {
    const data = new TextEncoder().encode("Retenção na fonte: 25 %.");
    await expect(
      extractor.extract({ fileName: "notas.txt", mimeType: "text/plain", data }),
    ).resolves.toBe("Retenção na fonte: 25 %.");
  });

  it("lê um DOCX", async () => {
    const text = await extractor.extract({
      fileName: "exemplo.docx",
      mimeType: "",
      data: fixture("exemplo.docx"),
    });
    expect(text).toContain("O IVA normal no continente é 23 %.");
    expect(text).toContain("Segundo parágrafo.");
  });

  it("lê um PDF", async () => {
    const text = await extractor.extract({
      fileName: "exemplo.pdf",
      mimeType: "application/pdf",
      data: fixture("exemplo.pdf"),
    });
    expect(text).toContain("O prazo do IRS termina em junho.");
  });

  it("recusa um tipo que não conhece", async () => {
    await expect(
      extractor.extract({ fileName: "folha.xlsx", mimeType: "", data: new Uint8Array([1]) }),
    ).rejects.toMatchObject({ status: 415, code: "UNSUPPORTED_FILE_TYPE" });
  });

  it("lê um CSV como texto, pela extensão ou pelo tipo", async () => {
    const data = new TextEncoder().encode("Data,Valor\n12/11,40");

    expect(fileKind("despesas.csv", "")).toBe("text");
    await expect(
      new FileTextExtractor().extract({ fileName: "", mimeType: "text/csv", data }),
    ).resolves.toBe("Data,Valor\n12/11,40");
  });

  it("conta as páginas de um PDF", async () => {
    await expect(pdfPageCount(fixture("exemplo.pdf"))).resolves.toBe(1);
  });

  it("não abre o que não é um PDF que se leia", async () => {
    await expect(pdfPageCount(new TextEncoder().encode("isto não é um PDF"))).rejects.toThrow();
  });
});
