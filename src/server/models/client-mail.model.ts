import { isValidNif, normalizeNif } from "./client.model";

export const INVOICE_DOC_TYPES = ["FT", "FS", "FR", "NC", "ND", "RC", "OUTRO"] as const;
export type InvoiceDocType = (typeof INVOICE_DOC_TYPES)[number];

export const INVOICE_STATUSES = ["EXTRAIDA", "A_REVER", "CONFIRMADA", "REJEITADA"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export type InvoiceDirection = "COMPRA" | "VENDA" | "DESCONHECIDA";

export const EMAIL_CATEGORIES = ["FATURAS", "DOCUMENTOS", "PEDIDO", "INFORMACAO", "OUTRO"] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

export const DOC_TYPE_LABELS: Record<InvoiceDocType, string> = {
  FT: "Fatura",
  FS: "Fatura simplificada",
  FR: "Fatura-recibo",
  NC: "Nota de crédito",
  ND: "Nota de débito",
  RC: "Recibo",
  OUTRO: "Outro",
};

export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  EXTRAIDA: "Extraída",
  A_REVER: "A rever",
  CONFIRMADA: "Confirmada",
  REJEITADA: "Rejeitada",
};

export const CATEGORY_LABELS: Record<EmailCategory, string> = {
  FATURAS: "Faturas",
  DOCUMENTOS: "Documentos",
  PEDIDO: "Pedido",
  INFORMACAO: "Informação",
  OUTRO: "Outro",
};

export interface VatLine {
  rate: number;
  base: number;
  vat: number;
}

/** Os campos de um documento fiscal, tal como o extrator os leu. */
export interface ExtractedInvoice {
  docType: InvoiceDocType;
  number: string | null;
  atcud: string | null;
  /** AAAA-MM-DD. */
  issueDate: string | null;
  issuerName: string | null;
  issuerNif: string | null;
  buyerName: string | null;
  buyerNif: string | null;
  netTotal: number | null;
  vatTotal: number | null;
  total: number | null;
  currency: string;
  vatBreakdown: VatLine[];
  /** 0 a 1: quanto o extrator confia na leitura. */
  confidence: number;
}

export interface ClientEmailRecord {
  id: string;
  clientId: string;
  mailbox: string;
  gmailMessageId: string;
  gmailThreadId: string | null;
  fromAddress: string;
  subject: string;
  receivedAt: Date;
  summary: string;
  category: string;
  actionNeeded: boolean;
  attachmentCount: number;
}

export interface InvoiceRecord extends ExtractedInvoice {
  id: string;
  clientId: string;
  clientName: string;
  emailId: string;
  emailSubject: string;
  receivedAt: Date;
  fileName: string;
  mimeType: string;
  direction: InvoiceDirection;
  status: InvoiceStatus;
  reviewReasons: string[];
}

/** Abaixo disto, a leitura fica a rever. */
export const MIN_CONFIDENCE = 0.8;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * As verificações que decidem se uma fatura extraída fica «Extraída» ou «A rever»:
 * NIFs válidos, totais que batem certo, e a confiança do extrator.
 */
export function reviewReasons(invoice: ExtractedInvoice): string[] {
  const reasons: string[] = [];
  if (invoice.confidence < MIN_CONFIDENCE) reasons.push("Leitura com pouca confiança.");
  for (const [label, nif] of [
    ["emitente", invoice.issuerNif],
    ["adquirente", invoice.buyerNif],
  ] as const) {
    // Um NIF estrangeiro (com letras) não se valida pelas regras portuguesas.
    if (nif && /^\d+$/.test(nif) && !isValidNif(nif)) reasons.push(`NIF do ${label} inválido.`);
  }
  if (!invoice.issuerNif) reasons.push("Falta o NIF do emitente.");
  if (invoice.total === null) reasons.push("Falta o total.");
  if (!invoice.issueDate) reasons.push("Falta a data.");
  if (invoice.netTotal !== null && invoice.vatTotal !== null && invoice.total !== null) {
    if (Math.abs(round2(invoice.netTotal + invoice.vatTotal) - invoice.total) > 0.02)
      reasons.push("Base + IVA não dá o total.");
  }
  if (invoice.vatBreakdown.length && invoice.vatTotal !== null) {
    const sum = round2(invoice.vatBreakdown.reduce((acc, l) => acc + l.vat, 0));
    if (Math.abs(sum - invoice.vatTotal) > 0.02) reasons.push("O IVA por taxa não dá o IVA total.");
  }
  return reasons;
}

/** Se o cliente comprou (é o adquirente) ou vendeu (é o emitente). */
export function directionFor(
  invoice: ExtractedInvoice,
  clientNif: string | null,
): InvoiceDirection {
  if (!clientNif) return "DESCONHECIDA";
  if (invoice.buyerNif && normalizeNif(invoice.buyerNif) === clientNif) return "COMPRA";
  if (invoice.issuerNif && normalizeNif(invoice.issuerNif) === clientNif) return "VENDA";
  return "DESCONHECIDA";
}

/** O endereço de um cabeçalho From: «Ana <ana@x.pt>» → «ana@x.pt». */
export function addressOf(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return (match ? match[1] : from).trim().toLowerCase();
}
