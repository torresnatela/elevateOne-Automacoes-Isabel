import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  ClientEmailRecord,
  ExtractedInvoice,
  InvoiceDirection,
  InvoiceRecord,
  InvoiceStatus,
  VatLine,
} from "@/server/models/client-mail.model";

export interface NewClientEmail {
  clientId: string;
  googleAccountId: string;
  mailbox: string;
  gmailMessageId: string;
  gmailThreadId: string | null;
  rfcMessageId: string;
  fromAddress: string;
  subject: string;
  receivedAt: Date;
  summary: string;
  category: string;
  actionNeeded: boolean;
  attachmentCount: number;
}

export interface NewInvoice extends ExtractedInvoice {
  attachmentPartId: string;
  fileName: string;
  mimeType: string;
  direction: InvoiceDirection;
  status: InvoiceStatus;
  reviewReasons: string[];
  raw: unknown;
}

export interface InvoiceFilter {
  clientId?: string;
  status?: InvoiceStatus;
  /** Data de emissão (ou de receção, sem data) a partir de / até. */
  from?: Date;
  to?: Date;
  limit?: number;
}

export type InvoicePatch = Partial<
  Pick<
    ExtractedInvoice,
    | "docType"
    | "number"
    | "atcud"
    | "issueDate"
    | "issuerName"
    | "issuerNif"
    | "buyerName"
    | "buyerNif"
    | "netTotal"
    | "vatTotal"
    | "total"
  >
> & { status?: InvoiceStatus; reviewReasons?: string[]; reviewedById?: string };

/** Onde está o anexo de uma fatura: a caixa, o email e a parte. */
export interface InvoiceSource {
  invoiceId: string;
  fileName: string;
  mimeType: string;
  ownerUserId: string | null;
  gmailMessageId: string;
  attachmentPartId: string;
}

export interface MailSyncStateRecord {
  googleAccountId: string;
  syncedUntil: Date | null;
  lastRunAt: Date | null;
  lastError: string | null;
}

/** Contrato de persistência do que o agente de faturas lê e guarda. */
export interface ClientMailRepository {
  /** Os ids desta lista que já foram tratados nesta caixa. */
  seenIds(googleAccountId: string, gmailMessageIds: string[]): Promise<Set<string>>;
  markSeen(googleAccountId: string, gmailMessageIds: string[]): Promise<void>;
  /** O email (pelo Message-ID) já foi guardado, de qualquer caixa. */
  hasRfcMessageId(rfcMessageId: string): Promise<boolean>;
  /** Guarda o email e as faturas dele, e marca-o como tratado, tudo de uma vez. */
  saveEmail(email: NewClientEmail, invoices: NewInvoice[]): Promise<{ invoices: number }>;

  getSyncState(googleAccountId: string): Promise<MailSyncStateRecord | null>;
  listSyncStates(): Promise<MailSyncStateRecord[]>;
  setSyncState(state: MailSyncStateRecord): Promise<void>;

  /** Fica com o trinco se estiver livre (ou expirado). */
  tryLock(name: string, ttlMs: number): Promise<boolean>;
  unlock(name: string): Promise<void>;

  listEmails(clientId: string, limit?: number): Promise<ClientEmailRecord[]>;
  listInvoices(filter: InvoiceFilter): Promise<InvoiceRecord[]>;
  findInvoiceSource(id: string): Promise<InvoiceSource | null>;
  /**
   * `null` se a fatura não existe. Com `onlyIfStatus`, só escreve se o estado guardado ainda for
   * esse (senão devolve a fatura como está): outra pessoa pode tê-la confirmado entretanto.
   */
  updateInvoice(
    id: string,
    patch: InvoicePatch,
    onlyIfStatus?: InvoiceStatus,
  ): Promise<InvoiceRecord | null>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toNumber = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));
const toDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const fromDay = (s: string | null) => (s ? new Date(`${s}T00:00:00.000Z`) : null);

/** Um intervalo de dias (`to` inclui o dia todo quando se compara com um instante). */
const range = (from?: Date, to?: Date, instant = false) => ({
  ...(from ? { gte: from } : {}),
  ...(to ? (instant ? { lt: new Date(to.getTime() + 24 * 60 * 60_000) } : { lte: to }) : {}),
});

const INVOICE_INCLUDE = {
  client: { select: { name: true } },
  email: { select: { subject: true, receivedAt: true } },
} satisfies Prisma.InvoiceInclude;

type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof INVOICE_INCLUDE }>;

function toInvoice(row: InvoiceRow): InvoiceRecord {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.client.name,
    emailId: row.emailId,
    emailSubject: row.email.subject,
    receivedAt: row.email.receivedAt,
    fileName: row.fileName,
    mimeType: row.mimeType,
    docType: row.docType,
    direction: row.direction,
    number: row.number,
    atcud: row.atcud,
    issueDate: toDay(row.issueDate),
    issuerName: row.issuerName,
    issuerNif: row.issuerNif,
    buyerName: row.buyerName,
    buyerNif: row.buyerNif,
    netTotal: toNumber(row.netTotal),
    vatTotal: toNumber(row.vatTotal),
    total: toNumber(row.total),
    currency: row.currency,
    vatBreakdown: (row.vatBreakdown as VatLine[] | null) ?? [],
    confidence: row.confidence,
    status: row.status,
    reviewReasons: row.reviewReasons,
  };
}

export class PrismaClientMailRepository implements ClientMailRepository {
  constructor(private readonly db: PrismaClient) {}

  async seenIds(googleAccountId: string, gmailMessageIds: string[]) {
    if (gmailMessageIds.length === 0) return new Set<string>();
    const rows = await this.db.mailSeenMessage.findMany({
      where: { googleAccountId, gmailMessageId: { in: gmailMessageIds } },
      select: { gmailMessageId: true },
    });
    return new Set(rows.map((r) => r.gmailMessageId));
  }

  async markSeen(googleAccountId: string, gmailMessageIds: string[]) {
    if (gmailMessageIds.length === 0) return;
    await this.db.mailSeenMessage.createMany({
      data: gmailMessageIds.map((gmailMessageId) => ({ googleAccountId, gmailMessageId })),
      skipDuplicates: true,
    });
  }

  async hasRfcMessageId(rfcMessageId: string) {
    return (await this.db.clientEmail.count({ where: { rfcMessageId } })) > 0;
  }

  async saveEmail(email: NewClientEmail, invoices: NewInvoice[]) {
    await this.db.$transaction(async (tx) => {
      const saved = await tx.clientEmail.create({ data: email });
      if (invoices.length)
        await tx.invoice.createMany({
          data: invoices.map((inv) => ({
            clientId: email.clientId,
            emailId: saved.id,
            attachmentPartId: inv.attachmentPartId,
            fileName: inv.fileName,
            mimeType: inv.mimeType,
            docType: inv.docType,
            direction: inv.direction,
            number: inv.number,
            atcud: inv.atcud,
            issueDate: fromDay(inv.issueDate),
            issuerName: inv.issuerName,
            issuerNif: inv.issuerNif,
            buyerName: inv.buyerName,
            buyerNif: inv.buyerNif,
            netTotal: inv.netTotal,
            vatTotal: inv.vatTotal,
            total: inv.total,
            currency: inv.currency,
            vatBreakdown: inv.vatBreakdown as unknown as Prisma.InputJsonValue,
            confidence: inv.confidence,
            status: inv.status,
            reviewReasons: inv.reviewReasons,
            raw: (inv.raw ?? {}) as Prisma.InputJsonValue,
          })),
        });
      await tx.mailSeenMessage.createMany({
        data: [{ googleAccountId: email.googleAccountId, gmailMessageId: email.gmailMessageId }],
        skipDuplicates: true,
      });
    });
    return { invoices: invoices.length };
  }

  async getSyncState(googleAccountId: string) {
    return this.db.mailSyncState.findUnique({ where: { googleAccountId } });
  }

  async listSyncStates() {
    return this.db.mailSyncState.findMany();
  }

  async setSyncState(state: MailSyncStateRecord) {
    const { googleAccountId, ...data } = state;
    await this.db.mailSyncState.upsert({
      where: { googleAccountId },
      update: data,
      create: state,
    });
  }

  async tryLock(name: string, ttlMs: number) {
    const until = new Date(Date.now() + ttlMs);
    const rows = await this.db.$queryRaw<{ name: string }[]>`
      INSERT INTO "job_locks" ("name", "locked_until") VALUES (${name}, ${until})
      ON CONFLICT ("name") DO UPDATE SET "locked_until" = EXCLUDED."locked_until"
        WHERE "job_locks"."locked_until" < now()
      RETURNING "name"`;
    return rows.length > 0;
  }

  async unlock(name: string) {
    await this.db.jobLock.deleteMany({ where: { name } });
  }

  async listEmails(clientId: string, limit = 100) {
    if (!UUID_RE.test(clientId)) return [];
    return this.db.clientEmail.findMany({
      where: { clientId },
      orderBy: { receivedAt: "desc" },
      take: limit,
      select: {
        id: true,
        clientId: true,
        mailbox: true,
        gmailMessageId: true,
        gmailThreadId: true,
        fromAddress: true,
        subject: true,
        receivedAt: true,
        summary: true,
        category: true,
        actionNeeded: true,
        attachmentCount: true,
      },
    });
  }

  async listInvoices(filter: InvoiceFilter) {
    if (filter.clientId && !UUID_RE.test(filter.clientId)) return [];
    const rows = await this.db.invoice.findMany({
      where: {
        ...(filter.clientId ? { clientId: filter.clientId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        // Sem data de emissão, conta a data em que o email chegou.
        ...(filter.from || filter.to
          ? {
              OR: [
                { issueDate: range(filter.from, filter.to) },
                { issueDate: null, email: { receivedAt: range(filter.from, filter.to, true) } },
              ],
            }
          : {}),
      },
      include: INVOICE_INCLUDE,
      orderBy: [{ issueDate: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
      take: filter.limit ?? 500,
    });
    return rows.map(toInvoice);
  }

  async findInvoiceSource(id: string) {
    if (!UUID_RE.test(id)) return null;
    const row = await this.db.invoice.findUnique({
      where: { id },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        attachmentPartId: true,
        email: {
          select: { gmailMessageId: true, googleAccount: { select: { userId: true } } },
        },
      },
    });
    if (!row) return null;
    return {
      invoiceId: row.id,
      fileName: row.fileName,
      mimeType: row.mimeType,
      ownerUserId: row.email.googleAccount?.userId ?? null,
      gmailMessageId: row.email.gmailMessageId,
      attachmentPartId: row.attachmentPartId,
    };
  }

  async updateInvoice(id: string, patch: InvoicePatch, onlyIfStatus?: InvoiceStatus) {
    if (!UUID_RE.test(id)) return null;
    const { issueDate, reviewedById, ...rest } = patch;
    const data: Prisma.InvoiceUpdateManyMutationInput = {
      ...rest,
      ...(issueDate !== undefined ? { issueDate: fromDay(issueDate) } : {}),
      ...(reviewedById ? { reviewedById, reviewedAt: new Date() } : {}),
    };
    await this.db.invoice.updateMany({
      where: { id, ...(onlyIfStatus ? { status: onlyIfStatus } : {}) },
      data,
    });
    const row = await this.db.invoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
    return row ? toInvoice(row) : null;
  }
}
