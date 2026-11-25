import { Prisma } from "@prisma/client";
import {
  readableType,
  type InvoiceExtractor,
  type MailAttachment,
} from "@/server/integrations/anthropic/invoice-extractor";
import type { GoogleWorkspace } from "@/server/integrations/google/workspace";
import { addressOf, directionFor, reviewReasons } from "@/server/models/client-mail.model";
import type { Client } from "@/server/models/client.model";
import type {
  ClientMailRepository,
  NewInvoice,
} from "@/server/repositories/client-mail.repository";
import type { ClientRepository } from "@/server/repositories/client.repository";
import type { ConnectedGoogleAccount } from "@/server/repositories/google-account.repository";
import type { GoogleWorkspaceProvider } from "@/server/services/google.service";

export interface SyncOptions {
  /** Quantos emails novos se leem numa corrida (cada um é uma chamada ao modelo). */
  maxEmailsPerRun: number;
  /** Na primeira corrida de uma caixa, até quantos dias para trás. */
  lookbackDays: number;
  /** Quantos remetentes por procura no Gmail (a procura tem um tamanho máximo). */
  sendersPerQuery: number;
  /** Os anexos maiores do que isto ficam de fora. */
  maxAttachmentBytes: number;
  /** As imagens mais pequenas do que isto são logótipos de assinatura: ficam de fora. */
  minImageBytes: number;
  maxAttachmentsPerEmail: number;
}

export const DEFAULT_SYNC_OPTIONS: SyncOptions = {
  maxEmailsPerRun: 40,
  lookbackDays: 90,
  sendersPerQuery: 25,
  maxAttachmentBytes: 10 * 1024 * 1024,
  minImageBytes: 20 * 1024,
  maxAttachmentsPerEmail: 10,
};

export interface AccountReport {
  mailbox: string;
  newEmails: number;
  invoices: number;
  pending: number;
  error: string | null;
}

export interface SyncReport {
  /** Outra corrida já estava a decorrer: esta não fez nada. */
  skipped: boolean;
  accounts: AccountReport[];
}

const LOCK = "client-mail-sync";
const LOCK_TTL_MS = 10 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** As procuras do Gmail para estes clientes, a partir de uma data. */
export function buildQueries(clients: Client[], since: Date, perQuery: number): string[] {
  const senders = [
    ...new Set(clients.flatMap((c) => [...c.contactEmails, ...c.emailDomains.map((d) => `@${d}`)])),
  ];
  const after = Math.floor(since.getTime() / 1000);
  const queries: string[] = [];
  for (let i = 0; i < senders.length; i += perQuery)
    queries.push(
      `from:(${senders.slice(i, i + perQuery).join(" OR ")}) after:${after} -in:sent -in:chats`,
    );
  return queries;
}

/** O cliente de um remetente: primeiro quem tem o endereço exato, depois quem tem o domínio. */
function pickClient(candidates: Client[], address: string): Client | null {
  return (
    candidates.find((c) => c.contactEmails.includes(address)) ??
    candidates.find((c) => c.emailDomains.includes(address.split("@").pop() ?? "")) ??
    null
  );
}

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/**
 * O agente de faturas: percorre as caixas Gmail ligadas, encontra os emails dos clientes,
 * resume-os e tira os campos das faturas anexas. Corre de hora a hora e no botão.
 */
export class ClientMailSyncService {
  constructor(
    private readonly deps: {
      accounts: { listAll(): Promise<ConnectedGoogleAccount[]> };
      google: GoogleWorkspaceProvider;
      clients: Pick<ClientRepository, "list" | "findByAddresses">;
      mail: ClientMailRepository;
      extractor: InvoiceExtractor;
      now?: () => Date;
      log?: (message: string) => void;
    },
    private readonly options: SyncOptions = DEFAULT_SYNC_OPTIONS,
  ) {}

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  async run(): Promise<SyncReport> {
    if (!(await this.deps.mail.tryLock(LOCK, LOCK_TTL_MS))) return { skipped: true, accounts: [] };
    try {
      const clients = (await this.deps.clients.list()).filter(
        (c) => c.contactEmails.length || c.emailDomains.length,
      );
      const accounts = await this.deps.accounts.listAll();
      const reports: AccountReport[] = [];
      let budget = this.options.maxEmailsPerRun;
      for (const account of accounts) {
        const report = await this.syncAccount(account, clients, budget);
        budget -= report.newEmails;
        reports.push(report);
      }
      return { skipped: false, accounts: reports };
    } finally {
      await this.deps.mail.unlock(LOCK);
    }
  }

  private async syncAccount(
    account: ConnectedGoogleAccount,
    clients: Client[],
    budget: number,
  ): Promise<AccountReport> {
    const report: AccountReport = {
      mailbox: account.email,
      newEmails: 0,
      invoices: 0,
      pending: 0,
      error: null,
    };
    const startedAt = this.now();
    const state = await this.deps.mail.getSyncState(account.id);
    // Um dia de folga: o «after:» do Gmail conta por dias e os emails chegam com atraso.
    const since = state?.syncedUntil
      ? new Date(state.syncedUntil.getTime() - DAY_MS)
      : new Date(startedAt.getTime() - this.options.lookbackDays * DAY_MS);
    let failures = 0;

    try {
      if (clients.length === 0) {
        await this.saveState(account.id, startedAt, state?.syncedUntil ?? null, null);
        return report;
      }
      const workspace = await this.deps.google.workspaceFor(account.userId);
      const ids = new Set<string>();
      for (const query of buildQueries(clients, since, this.options.sendersPerQuery))
        for (const id of await workspace.listMessageIds(query, 500)) ids.add(id);

      const seen = await this.deps.mail.seenIds(account.id, [...ids]);
      // O Gmail devolve do mais recente para trás: lê-se do mais antigo para a frente.
      const fresh = [...ids].filter((id) => !seen.has(id)).reverse();
      const batch = fresh.slice(0, Math.max(0, budget));
      report.pending = fresh.length - batch.length;

      for (const id of batch) {
        try {
          const saved = await this.processMessage(workspace, account, id);
          if (saved !== null) {
            report.newEmails += 1;
            report.invoices += saved;
          }
        } catch (err) {
          failures += 1;
          report.error = (err as Error).message;
          this.deps.log?.(`Faturas: o email ${id} de ${account.email} falhou: ${report.error}`);
        }
      }
      // Só se avança a marca quando tudo até agora ficou tratado.
      const done = failures === 0 && report.pending === 0;
      await this.saveState(
        account.id,
        startedAt,
        done ? startedAt : (state?.syncedUntil ?? null),
        report.error,
      );
    } catch (err) {
      report.error = (err as Error).message;
      await this.saveState(account.id, startedAt, state?.syncedUntil ?? null, report.error);
    }
    return report;
  }

  private saveState(
    googleAccountId: string,
    lastRunAt: Date,
    syncedUntil: Date | null,
    lastError: string | null,
  ) {
    return this.deps.mail.setSyncState({ googleAccountId, lastRunAt, syncedUntil, lastError });
  }

  /** Lê um email e guarda-o. Devolve quantas faturas tinha, ou `null` se não era para guardar. */
  private async processMessage(
    workspace: GoogleWorkspace,
    account: ConnectedGoogleAccount,
    id: string,
  ): Promise<number | null> {
    const { mail, clients, extractor } = this.deps;
    const email = await workspace.getEmail(id);
    const rfcMessageId = email.rfcMessageId || `gmail:${account.id}:${id}`;
    if (await mail.hasRfcMessageId(rfcMessageId)) {
      await mail.markSeen(account.id, [id]);
      return null;
    }
    const from = addressOf(email.from);
    const client = pickClient(await clients.findByAddresses([from]), from);
    if (!client) {
      await mail.markSeen(account.id, [id]);
      return null;
    }

    const attachments: MailAttachment[] = [];
    for (const a of email.attachments) {
      if (attachments.length >= this.options.maxAttachmentsPerEmail) break;
      const type = readableType(a);
      if (!type || a.size > this.options.maxAttachmentBytes) continue;
      if (type.startsWith("image/") && a.size < this.options.minImageBytes) continue;
      const file = await workspace.getAttachment(id, a.partId);
      attachments.push({ partId: a.partId, fileName: a.fileName, mimeType: type, data: file.data });
    }

    const extraction = await extractor.extract({
      from: email.from,
      subject: email.subject,
      date: email.date,
      body: email.body,
      clientName: client.name,
      clientNif: client.nif,
      attachments,
    });

    const invoices: NewInvoice[] = extraction.invoices.map(({ partId, ...inv }) => {
      const file = attachments.find((a) => a.partId === partId)!;
      const reasons = reviewReasons(inv);
      return {
        ...inv,
        attachmentPartId: partId,
        fileName: file.fileName,
        mimeType: file.mimeType,
        direction: directionFor(inv, client.nif),
        status: reasons.length ? "A_REVER" : "EXTRAIDA",
        reviewReasons: reasons,
        raw: inv,
      };
    });

    const received = new Date(email.date);
    try {
      await mail.saveEmail(
        {
          clientId: client.id,
          googleAccountId: account.id,
          mailbox: account.email,
          gmailMessageId: id,
          gmailThreadId: email.threadId ?? null,
          rfcMessageId,
          fromAddress: from,
          subject: email.subject || "(sem assunto)",
          receivedAt: Number.isNaN(received.getTime()) ? this.now() : received,
          summary: extraction.summary,
          category: extraction.category,
          actionNeeded: extraction.actionNeeded,
          attachmentCount: email.attachments.length,
        },
        invoices,
      );
    } catch (err) {
      // Outra caixa guardou o mesmo email entretanto.
      if (!isUniqueViolation(err)) throw err;
      await mail.markSeen(account.id, [id]);
      return null;
    }
    return invoices.length;
  }
}
