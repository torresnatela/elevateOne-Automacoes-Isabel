import type { FileContent } from "@/server/integrations/google/workspace";
import { AppError } from "@/server/lib/errors";
import {
  DOC_TYPE_LABELS,
  STATUS_LABELS,
  type ClientEmailRecord,
  type InvoiceRecord,
} from "@/server/models/client-mail.model";
import type {
  ClientMailRepository,
  InvoiceFilter,
  InvoicePatch,
} from "@/server/repositories/client-mail.repository";
import type { ConnectedGoogleAccount } from "@/server/repositories/google-account.repository";
import type { GoogleWorkspaceProvider } from "@/server/services/google.service";

export interface MailboxStatus {
  mailbox: string;
  lastRunAt: Date | null;
  syncedUntil: Date | null;
  lastError: string | null;
}

const notFound = () => new AppError("Fatura não encontrada.", 404, "INVOICE_NOT_FOUND");

/** O que a equipa vê e corrige do trabalho do agente de faturas. */
export class ClientMailService {
  constructor(
    private readonly mail: ClientMailRepository,
    private readonly accounts: { listAll(): Promise<ConnectedGoogleAccount[]> },
    private readonly google: GoogleWorkspaceProvider,
  ) {}

  listEmails(clientId: string): Promise<ClientEmailRecord[]> {
    return this.mail.listEmails(clientId);
  }

  listInvoices(filter: InvoiceFilter): Promise<InvoiceRecord[]> {
    return this.mail.listInvoices(filter);
  }

  /** Corrige campos ou muda o estado. Quem confirma ou rejeita fica registado. */
  async updateInvoice(id: string, patch: InvoicePatch, userId: string): Promise<InvoiceRecord> {
    const updated = await this.mail.updateInvoice(id, { ...patch, reviewedById: userId });
    if (!updated) throw notFound();
    if (updated.status === "CONFIRMADA" || updated.status === "REJEITADA") return updated;
    // Depois de uma correção, volta a ver-se o que ainda há para rever (e guarda-se o porquê),
    // a partir da fatura como está na base, não da cópia lida antes.
    return (await this.mail.refreshReviewStatus(id)) ?? updated;
  }

  /** O ficheiro da fatura, descarregado na hora da caixa Gmail onde chegou. */
  async invoiceFile(id: string): Promise<FileContent> {
    const source = await this.mail.findInvoiceSource(id);
    if (!source) throw notFound();
    if (!source.ownerUserId)
      throw new AppError(
        "A conta Google onde esta fatura chegou já não está ligada.",
        409,
        "MAILBOX_DISCONNECTED",
      );
    const workspace = await this.google.workspaceFor(source.ownerUserId);
    const file = await workspace.getAttachment(source.gmailMessageId, source.attachmentPartId);
    return { ...file, name: source.fileName, mimeType: source.mimeType };
  }

  /** O estado de cada caixa ligada: quando foi lida e se deu erro. */
  async mailboxes(): Promise<MailboxStatus[]> {
    const [accounts, states] = await Promise.all([
      this.accounts.listAll(),
      this.mail.listSyncStates(),
    ]);
    return accounts.map((a) => {
      const state = states.find((s) => s.googleAccountId === a.id);
      return {
        mailbox: a.email,
        lastRunAt: state?.lastRunAt ?? null,
        syncedUntil: state?.syncedUntil ?? null,
        lastError: state?.lastError ?? null,
      };
    });
  }
}

/** Um texto que o Excel leria como fórmula (=, +, -, @, tab, CR) passa a texto com um apóstrofo. */
const safeText = (v: string | null | undefined) =>
  v && /^[=+\-@\t\r]/.test(v) ? `'${v}` : (v ?? "");

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const decimal = (n: number | null) => (n === null ? "" : n.toFixed(2).replace(".", ","));

/** As faturas em CSV (separado por «;», vírgula decimal: abre bem no Excel em português). */
export function invoicesToCsv(invoices: InvoiceRecord[]): string {
  const header = [
    "Cliente",
    "Estado",
    "Tipo",
    "Número",
    "ATCUD",
    "Data",
    "Emitente",
    "NIF emitente",
    "Adquirente",
    "NIF adquirente",
    "Base",
    "IVA",
    "Total",
    "Moeda",
    "Ficheiro",
  ];
  const rows = invoices.map((i) =>
    [
      safeText(i.clientName),
      STATUS_LABELS[i.status],
      DOC_TYPE_LABELS[i.docType],
      safeText(i.number),
      safeText(i.atcud),
      i.issueDate,
      safeText(i.issuerName),
      safeText(i.issuerNif),
      safeText(i.buyerName),
      safeText(i.buyerNif),
      decimal(i.netTotal),
      decimal(i.vatTotal),
      decimal(i.total),
      safeText(i.currency),
      safeText(i.fileName),
    ]
      .map(csvCell)
      .join(";"),
  );
  return "﻿" + [header.join(";"), ...rows].join("\r\n") + "\r\n";
}
