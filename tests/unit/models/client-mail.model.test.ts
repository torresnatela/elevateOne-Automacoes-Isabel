import {
  addressOf,
  directionFor,
  reviewReasons,
  type ExtractedInvoice,
} from "@/server/models/client-mail.model";

const invoice = (over: Partial<ExtractedInvoice> = {}): ExtractedInvoice => ({
  docType: "FT",
  number: "FT 2026/1",
  atcud: "ABCD-1",
  issueDate: "2026-11-02",
  issuerName: "Fornecedor",
  issuerNif: "500000000",
  buyerName: "Cliente",
  buyerNif: "123456789",
  netTotal: 100,
  vatTotal: 23,
  total: 123,
  currency: "EUR",
  vatBreakdown: [{ rate: 23, base: 100, vat: 23 }],
  confidence: 0.95,
  ...over,
});

describe("reviewReasons", () => {
  it("uma fatura coerente não tem nada a rever", () => {
    expect(reviewReasons(invoice())).toEqual([]);
  });

  it.each([
    [{ confidence: 0.5 }, "pouca confiança"],
    [{ issuerNif: "500000001" }, "NIF do emitente inválido"],
    [{ issuerNif: null }, "Falta o NIF do emitente"],
    [{ total: 130 }, "Base + IVA"],
    [{ vatBreakdown: [{ rate: 23, base: 100, vat: 20 }] }, "IVA por taxa"],
    [{ issueDate: null }, "Falta a data"],
  ])("assinala %j", (over, reason) => {
    expect(reviewReasons(invoice(over)).join(" ")).toContain(reason);
  });

  it("não valida pelas regras portuguesas um NIF estrangeiro", () => {
    expect(reviewReasons(invoice({ issuerNif: "ESB12345678" }))).toEqual([]);
  });
});

it("directionFor sabe se o cliente comprou ou vendeu", () => {
  expect(directionFor(invoice(), "123456789")).toBe("COMPRA");
  expect(directionFor(invoice(), "500000000")).toBe("VENDA");
  expect(directionFor(invoice(), null)).toBe("DESCONHECIDA");
});

it("addressOf tira o endereço do cabeçalho From", () => {
  expect(addressOf("Ana Silva <Ana@Empresa.pt>")).toBe("ana@empresa.pt");
  expect(addressOf("ana@empresa.pt")).toBe("ana@empresa.pt");
});
