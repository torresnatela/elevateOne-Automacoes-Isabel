import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AppError } from "@/server/lib/errors";
import {
  EMAIL_CATEGORIES,
  INVOICE_DOC_TYPES,
  isRealDay,
  type EmailCategory,
  type ExtractedInvoice,
} from "@/server/models/client-mail.model";
import { anthropicClientOptions } from "./anthropic-client";

/** Um anexo que o extrator lê. */
export interface MailAttachment {
  partId: string;
  fileName: string;
  mimeType: string;
  data: Uint8Array;
}

export interface MailToExtract {
  from: string;
  subject: string;
  date: string;
  body: string;
  clientName: string;
  clientNif: string | null;
  attachments: MailAttachment[];
}

export interface MailExtraction {
  summary: string;
  category: EmailCategory;
  actionNeeded: boolean;
  /** Um por anexo que é um documento fiscal (os outros ficam de fora). */
  invoices: (ExtractedInvoice & { partId: string })[];
}

/** Lê um email de um cliente: resume-o e tira os campos das faturas anexas. */
export interface InvoiceExtractor {
  extract(mail: MailToExtract): Promise<MailExtraction>;
}

/** Os tipos de anexo que o modelo consegue ler. */
export const READABLE_TYPES: Record<string, "pdf" | "image" | "text"> = {
  "application/pdf": "pdf",
  "image/jpeg": "image",
  "image/png": "image",
  "image/gif": "image",
  "image/webp": "image",
  "application/xml": "text",
  "text/xml": "text",
  "text/plain": "text",
  "text/csv": "text",
};

/** O tipo de um anexo pelo nome, quando o email diz só «application/octet-stream». */
export function readableType(file: { fileName: string; mimeType: string }): string | null {
  const mime = file.mimeType.toLowerCase();
  if (READABLE_TYPES[mime]) return mime;
  const ext = file.fileName.toLowerCase().split(".").pop() ?? "";
  const byExt: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    xml: "application/xml",
    txt: "text/plain",
    csv: "text/csv",
  };
  return byExt[ext] ?? null;
}

const nullableString = z
  .string()
  .nullish()
  .transform((v) => (v?.trim() ? v.trim() : null));
const nullableNumber = z
  .number()
  .nullish()
  .transform((v) => v ?? null);

const documentSchema = z.object({
  partId: z.string().describe("O id do anexo, tal como vem indicado antes de cada ficheiro."),
  isFiscalDocument: z
    .boolean()
    .describe("true se o anexo é um documento fiscal (fatura, fatura-recibo, nota de crédito…)."),
  docType: z.enum(INVOICE_DOC_TYPES).catch("OUTRO"),
  number: nullableString.describe("O número do documento, ex.: «FT 2026/123»."),
  atcud: nullableString,
  issueDate: nullableString.describe("A data de emissão, AAAA-MM-DD."),
  issuerName: nullableString,
  issuerNif: nullableString.describe(
    "O NIF do emitente, só dígitos (ou com prefixo do país se estrangeiro).",
  ),
  buyerName: nullableString,
  buyerNif: nullableString,
  netTotal: nullableNumber.describe("A base tributável total (sem IVA)."),
  vatTotal: nullableNumber.describe("O IVA total."),
  total: nullableNumber.describe("O total a pagar, com IVA."),
  currency: z.string().length(3).catch("EUR"),
  vatBreakdown: z
    .array(z.object({ rate: z.number(), base: z.number(), vat: z.number() }))
    .catch([])
    .describe("O IVA por taxa: rate em percentagem (23, 13, 6, 0)."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .catch(0)
    .describe("0 a 1: quanto confias na leitura (baixa se o documento é ilegível ou ambíguo)."),
});

const extractionSchema = z.object({
  summary: z
    .string()
    .describe(
      "O resumo do email em 1 a 3 frases, em português de Portugal: o que o cliente envia ou pede.",
    ),
  category: z.enum(EMAIL_CATEGORIES).catch("OUTRO"),
  actionNeeded: z
    .boolean()
    .describe("true se o cliente pede alguma coisa ou espera resposta do gabinete."),
  documents: z.array(documentSchema).default([]),
});

const TOOL_NAME = "registar_email";

const SYSTEM = `És o assistente de um gabinete de contabilidade em Portugal. Recebes um email que um cliente enviou ao gabinete, com os anexos.
1. Resume o email (o que envia, o que pede, prazos mencionados).
2. Para cada anexo, diz se é um documento fiscal português ou estrangeiro (fatura, fatura simplificada, fatura-recibo, nota de crédito/débito, recibo) e, se for, lê os campos.
Regras: não inventes valores — o que não consegues ler fica a null e baixas a confiança. Os montantes são números (ponto decimal, sem símbolo). As datas em AAAA-MM-DD. Responde sempre, e só, chamando a ferramenta ${TOOL_NAME} uma vez.`;

const MAX_BODY = 8000;

/** A parte da API da Anthropic de que o extrator precisa (os testes dão-lhe uma falsa). */
export interface AnthropicCreate {
  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<{ content: unknown[] }>;
}

export class AnthropicInvoiceExtractor implements InvoiceExtractor {
  constructor(
    private readonly api: AnthropicCreate,
    private readonly model: string,
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): AnthropicInvoiceExtractor {
    let client: Anthropic | undefined;
    return new AnthropicInvoiceExtractor(
      {
        create: (params) => {
          client ??= new Anthropic(anthropicClientOptions(env));
          return client.messages.create(params);
        },
      },
      env.INVOICE_EXTRACTOR_MODEL || "claude-sonnet-5-5",
    );
  }

  async extract(mail: MailToExtract): Promise<MailExtraction> {
    const content: Anthropic.ContentBlockParam[] = [
      {
        type: "text",
        text: [
          `Cliente: ${mail.clientName}${mail.clientNif ? ` (NIF ${mail.clientNif})` : ""}`,
          `De: ${mail.from}`,
          `Data: ${mail.date}`,
          `Assunto: ${mail.subject}`,
          "",
          mail.body.slice(0, MAX_BODY) || "(sem texto)",
        ].join("\n"),
      },
    ];
    for (const file of mail.attachments) {
      const type = readableType(file);
      if (!type) continue;
      content.push({ type: "text", text: `Anexo partId=${file.partId}: ${file.fileName}` });
      const data = Buffer.from(file.data).toString("base64");
      if (type === "application/pdf")
        content.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data },
        });
      else if (type.startsWith("image/"))
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: type as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data,
          },
        });
      else
        content.push({
          type: "document",
          source: {
            type: "text",
            media_type: "text/plain",
            data: Buffer.from(file.data).toString("utf8").slice(0, 100_000),
          },
        });
    }

    const response = await this.api
      .create({
        model: this.model,
        max_tokens: 16000,
        system: SYSTEM,
        tools: [
          {
            name: TOOL_NAME,
            description: "Regista o resumo do email e os documentos fiscais anexos.",
            input_schema: zodToJsonSchema(extractionSchema, {
              target: "jsonSchema7",
              $refStrategy: "none",
            }) as Anthropic.Tool.InputSchema,
          },
        ],
        // O Sonnet 5.5 recusa `tool_choice` forçado (400): fica em `auto`, e o prompt manda usar a ferramenta.
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content }],
      })
      .catch((error: unknown) => {
        if (error instanceof Anthropic.BadRequestError)
          throw new AppError(
            `O modelo recusou o email: ${error.message}`,
            502,
            "EXTRACTOR_BAD_REQUEST",
          );
        throw error;
      });

    const call = response.content.find(
      (b): b is { type: "tool_use"; input: unknown } =>
        (b as { type?: string }).type === "tool_use",
    );
    if (!call) throw new AppError("O modelo não devolveu a leitura.", 502, "EXTRACTOR_NO_OUTPUT");
    return parseExtraction(call.input, new Set(mail.attachments.map((a) => a.partId)));
  }
}

/** Valida o que o modelo devolveu e fica só com os documentos fiscais de anexos que existem. */
export function parseExtraction(input: unknown, partIds: Set<string>): MailExtraction {
  const parsed = extractionSchema.parse(input);
  const seen = new Set<string>();
  return {
    summary: parsed.summary.trim(),
    category: parsed.category,
    actionNeeded: parsed.actionNeeded,
    invoices: parsed.documents
      .filter((d) => d.isFiscalDocument && partIds.has(d.partId))
      .filter((d) => !seen.has(d.partId) && seen.add(d.partId))
      .map(({ isFiscalDocument: _f, ...d }) => ({
        ...d,
        issueDate: d.issueDate && isRealDay(d.issueDate) ? d.issueDate : null,
        currency: d.currency.toUpperCase(),
      })),
  };
}
