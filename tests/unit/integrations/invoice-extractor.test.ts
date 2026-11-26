import {
  AnthropicInvoiceExtractor,
  parseExtraction,
  readableType,
} from "@/server/integrations/anthropic/invoice-extractor";

const doc = (partId: string, over: Record<string, unknown> = {}) => ({
  partId,
  isFiscalDocument: true,
  docType: "FT",
  issueDate: "2026-11-02",
  total: 123,
  confidence: 0.9,
  ...over,
});

describe("parseExtraction", () => {
  it("fica só com documentos fiscais de anexos que existem, sem repetidos", () => {
    const r = parseExtraction(
      {
        summary: " Envia as faturas de outubro. ",
        category: "FATURAS",
        actionNeeded: false,
        documents: [
          doc("1"),
          doc("1"),
          doc("2", { isFiscalDocument: false }),
          doc("9"),
          doc("3", { docType: "XYZ", issueDate: "02/11/2026", currency: "eur" }),
        ],
      },
      new Set(["1", "2", "3"]),
    );
    expect(r.summary).toBe("Envia as faturas de outubro.");
    expect(r.invoices.map((i) => i.partId)).toEqual(["1", "3"]);
    expect(r.invoices[1]).toMatchObject({ docType: "OUTRO", issueDate: null, currency: "EUR" });
    expect(r.invoices[0]).toMatchObject({ number: null, vatBreakdown: [] });
  });

  it("uma categoria desconhecida passa a OUTRO", () => {
    expect(
      parseExtraction({ summary: "x", category: "SPAM", actionNeeded: true }, new Set()).category,
    ).toBe("OUTRO");
  });
});

it("readableType reconhece pelo nome o que vem como octet-stream", () => {
  expect(readableType({ fileName: "FT 1.PDF", mimeType: "application/octet-stream" })).toBe(
    "application/pdf",
  );
  expect(readableType({ fileName: "a.zip", mimeType: "application/zip" })).toBeNull();
});

it("AnthropicInvoiceExtractor manda o PDF ao modelo, com a ferramenta em auto (o Sonnet 5.5 recusa forçar)", async () => {
  const create = vi.fn().mockResolvedValue({
    content: [
      {
        type: "tool_use",
        input: {
          summary: "Fatura.",
          category: "FATURAS",
          actionNeeded: false,
          documents: [doc("1")],
        },
      },
    ],
  });
  const extractor = new AnthropicInvoiceExtractor({ create }, "modelo-x");
  const result = await extractor.extract({
    from: "a@x.pt",
    subject: "Fatura",
    date: "",
    body: "Segue.",
    clientName: "X",
    clientNif: null,
    attachments: [
      { partId: "1", fileName: "f.pdf", mimeType: "application/pdf", data: new Uint8Array([1]) },
      { partId: "2", fileName: "a.zip", mimeType: "application/zip", data: new Uint8Array([1]) },
    ],
  });
  expect(result.invoices).toHaveLength(1);
  const params = create.mock.calls[0][0];
  expect(params.model).toBe("modelo-x");
  expect(params.tool_choice).toEqual({ type: "auto" });
  expect(params.tools[0].name).toBe("registar_email");
  const types = params.messages[0].content.map((b: { type: string }) => b.type);
  expect(types.filter((t: string) => t === "document")).toHaveLength(1);
});

it("AnthropicInvoiceExtractor falha se o modelo não chamar a ferramenta", async () => {
  const create = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "Olá" }] });
  const extractor = new AnthropicInvoiceExtractor({ create }, "m");
  await expect(
    extractor.extract({
      from: "a@x.pt",
      subject: "s",
      date: "",
      body: "",
      clientName: "X",
      clientNif: null,
      attachments: [],
    }),
  ).rejects.toMatchObject({ code: "EXTRACTOR_NO_OUTPUT" });
});
