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
  /** Quantos bytes de anexos vão, no máximo, num só pedido ao modelo (a API aceita 32 MB, já em base64). */
  maxRequestBytes: number;
  /** Quantos ids se pedem ao Gmail por procura; se vierem todos, a janela divide-se. */
  maxDiscovered: number;
  /** Até quantos ids se percorrem num só dia (por omissão, todos: nenhum fica por descobrir). */
  maxPerDay: number;
}

export const DEFAULT_SYNC_OPTIONS: SyncOptions = {
  maxEmailsPerRun: 40,
  lookbackDays: 90,
  sendersPerQuery: 25,
  maxAttachmentBytes: 10 * 1024 * 1024,
  minImageBytes: 20 * 1024,
  maxAttachmentsPerEmail: 10,
  maxRequestBytes: 18 * 1024 * 1024,
  maxDiscovered: 2000,
  maxPerDay: Number.POSITIVE_INFINITY,
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

/** As procuras do Gmail para estes clientes (sem datas: a janela junta-se em `discover`). */
export function buildQueries(clients: Client[], perQuery: number): string[] {
  const senders = [
    ...new Set(clients.flatMap((c) => [...c.contactEmails, ...c.emailDomains.map((d) => `@${d}`)])),
  ];
  const queries: string[] = [];
  for (let i = 0; i < senders.length; i += perQuery)
    queries.push(`from:(${senders.slice(i, i + perQuery).join(" OR ")}) -in:sent -in:chats`);
  return queries;
}

const epoch = (d: Date) => Math.floor(d.getTime() / 1000);

/**
 * Todos os ids de uma procura entre duas datas. O Gmail devolve só os mais recentes até ao
 * máximo pedido: quando a janela enche, divide-se ao meio até cada metade caber. Uma janela de
 * um dia que ainda enche percorre-se toda, página a página (sem teto, por omissão: nenhum email
 * fica por descobrir). Com `dayMax` finito, diz se um dia ficou cortado.
 */
export async function discover(
  list: (query: string, limit: number) => Promise<string[]>,
  query: string,
  from: Date,
  to: Date,
  max: number,
  dayMax: number = Number.POSITIVE_INFINITY,
): Promise<{ ids: string[]; truncated: boolean }> {
  const window = `${query} after:${epoch(from)} before:${epoch(to)}`;
  const found = await list(window, max);
  if (found.length < max) return { ids: found, truncated: false };
  if (to.getTime() - from.getTime() <= DAY_MS) {
    const all = await list(window, dayMax);
    return { ids: all, truncated: all.length >= dayMax };
  }
  const middle = new Date(
    Math.floor((from.getTime() + (to.getTime() - from.getTime()) / 2) / 1000) * 1000,
  );
  // As metades sobrepõem-se um segundo, para um email no instante do meio entrar numa delas.
  const [older, newer] = await Promise.all([
    discover(list, query, from, new Date(middle.getTime() + 1000), max, dayMax),
    discover(list, query, middle, to, max, dayMax),
  ]);
  return { ids: [...older.ids, ...newer.ids], truncated: older.truncated || newer.truncated };
}

/** O cliente de um remetente: primeiro quem tem o endereço exato, depois quem tem o domínio. */
function pickClient(candidates: Client[], address: string): Client | null {
  return (
    candidates.find((c) => c.contactEmails.includes(address)) ??
    candidates.find((c) => c.emailDomains.includes(address.split("@").pop() ?? "")) ??
    null
  );
}

/**
 * Os ids do Gmail crescem com o tempo de chegada: ordená-los pelo valor (hexadecimal) põe
 * por ordem os resultados de procuras diferentes, que o Gmail não ordena entre si.
 */
export function oldestFirst(ids: string[]): string[] {
  const value = (id: string) => (/^[0-9a-f]+$/i.test(id) ? BigInt(`0x${id}`) : 0n);
  return [...ids].sort((a, b) => {
    const [x, y] = [value(a), value(b)];
    return x < y ? -1 : x > y ? 1 : a.localeCompare(b);
  });
}

/** Junta os anexos em grupos que cabem num pedido ao modelo. */
export function batchAttachments<T extends { data: Uint8Array }>(
  files: T[],
  maxBytes: number,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const file of files) {
    if (current.length && size + file.data.byteLength > maxBytes) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(file);
    size += file.data.byteLength;
  }
  if (current.length || batches.length === 0) batches.push(current);
  return batches;
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

  /** Há uma corrida a decorrer agora (de qualquer origem: o agendamento, ou o botão noutro separador). */
  isRunning(): Promise<boolean> {
    return this.deps.mail.isLocked(LOCK);
  }

  /**
   * Como está a tarefa: a correr, livre (a última acabou e gravou o resultado), ou abandonada
   * (o trinco expirou sem se soltar: a última corrida falhou sem conseguir gravar o erro).
   */
  async runState(): Promise<"running" | "idle" | "abandoned"> {
    const state = await this.deps.mail.lockState(LOCK);
    return state === "held" ? "running" : state === "free" ? "idle" : "abandoned";
  }

  async run(): Promise<SyncReport> {
    if (!(await this.deps.mail.tryLock(LOCK, LOCK_TTL_MS))) return { skipped: true, accounts: [] };
    try {
      return await this.runLocked();
    } finally {
      await this.release();
    }
  }

  /** Falhou também a gravação do erro da corrida: o trinco fica até expirar (ver `release`). */
  private unrecordedFailure = false;

  /**
   * Solta o trinco — exceto se a corrida falhou e nem o erro se conseguiu gravar. Aí o trinco
   * fica até expirar sozinho (LOCK_TTL_MS): quem espera nunca vê uma corrida acabada sem
   * resultado (o que leria como «concluída»), e o painel acaba a dizer que não pôde confirmar.
   */
  private async release() {
    if (this.unrecordedFailure) {
      this.unrecordedFailure = false;
      this.deps.log?.("Faturas: a corrida falhou e o erro não se gravou; o trinco expira sozinho.");
      return;
    }
    await this.deps.mail.unlock(LOCK);
  }

  /**
   * Para o botão: fica com o trinco já, antes de responder, e corre depois (com `defer`).
   * Devolve se começou uma corrida; `false` quer dizer que outra já estava a correr. Assim,
   * enquanto o trinco estiver seguro há uma corrida a decorrer, e quem espera só tem de ver
   * quando ele se solta.
   */
  async start(defer: (task: () => Promise<void>) => void): Promise<boolean> {
    if (!(await this.deps.mail.tryLock(LOCK, LOCK_TTL_MS))) return false;
    defer(async () => {
      try {
        await this.runLocked();
      } catch (error) {
        this.deps.log?.(`Faturas: a corrida falhou: ${(error as Error).message}`);
      } finally {
        await this.release();
      }
    });
    return true;
  }

  /**
   * A corrida em si, com o trinco já na mão de quem chama. Se falhar antes de acabar (fora do
   * que cada caixa já regista), o erro fica no estado de todas as caixas: quem esperava por esta
   * corrida — mesmo noutro separador — vê que falhou, e não que concluiu.
   */
  private async runLocked(): Promise<SyncReport> {
    try {
      return await this.runAccounts();
    } catch (error) {
      const message = `A corrida falhou: ${(error as Error).message}`;
      try {
        for (const account of await this.deps.accounts.listAll())
          await this.deps.mail.recordRunError(account.id, message);
      } catch {
        // Nem o erro se gravou: o trinco fica até expirar, para ninguém ver «concluída».
        this.unrecordedFailure = true;
      }
      throw error;
    }
  }

  private async runAccounts(): Promise<SyncReport> {
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
    // Na primeira leitura, o início da janela fica guardado até ela acabar: se andasse com o
    // tempo, um email ainda por descobrir podia sair da janela.
    const startFrom =
      state?.startFrom ?? new Date(startedAt.getTime() - this.options.lookbackDays * DAY_MS);
    const since = state?.syncedUntil ? new Date(state.syncedUntil.getTime() - DAY_MS) : startFrom;
    let failures = 0;

    try {
      if (clients.length === 0) {
        await this.saveState(
          account.id,
          account.email,
          startedAt,
          state?.syncedUntil ?? null,
          null,
          startFrom,
        );
        return report;
      }
      const workspace = await this.deps.google.workspaceFor(account.userId);
      const ids = new Set<string>();
      let truncated = false;
      // Até amanhã: o «before:» exclui o próprio instante e os emails de hoje têm de entrar.
      const until = new Date(startedAt.getTime() + DAY_MS);
      for (const query of buildQueries(clients, this.options.sendersPerQuery)) {
        const found = await discover(
          (q, limit) => workspace.listMessageIds(q, limit),
          query,
          since,
          until,
          this.options.maxDiscovered,
          this.options.maxPerDay,
        );
        truncated ||= found.truncated;
        for (const id of found.ids) ids.add(id);
      }

      const seen = await this.deps.mail.seenIds(account.id, [...ids]);
      // Lê-se do mais antigo para a frente pela data de chegada (internalDate) que o Gmail dá a
      // cada email, juntando todas as procuras; o id só desempata.
      const unseen = oldestFirst([...ids].filter((id) => !seen.has(id)));
      const arrived = await workspace.messageDates(unseen);
      // Sem data (o Gmail não a deu), fica para o fim. A ordenação é estável: o id desempata.
      const at = (id: string) => arrived.get(id) ?? Number.MAX_SAFE_INTEGER;
      const fresh = [...unseen].sort((a, b) => at(a) - at(b));
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
      // Uma procura que devolveu o máximo pode ter deixado emails mais antigos por descobrir.
      const done = failures === 0 && report.pending === 0 && !truncated;
      // O aviso da procura cortada junta-se ao erro de um email, não o substitui.
      if (truncated)
        report.error = [
          report.error,
          `Há emails de clientes demais num só dia: alguns podem ter ficado por ler.`,
        ]
          .filter(Boolean)
          .join(" ");
      await this.saveState(
        account.id,
        account.email,
        startedAt,
        done ? startedAt : (state?.syncedUntil ?? null),
        report.error,
        startFrom,
      );
    } catch (err) {
      report.error = (err as Error).message;
      await this.saveState(
        account.id,
        account.email,
        startedAt,
        state?.syncedUntil ?? null,
        report.error,
        startFrom,
      );
    }
    return report;
  }

  private saveState(
    googleAccountId: string,
    mailbox: string,
    lastRunAt: Date,
    syncedUntil: Date | null,
    lastError: string | null,
    startFrom: Date | null,
  ) {
    return this.deps.mail.setSyncState(
      { googleAccountId, lastRunAt, syncedUntil, lastError, startFrom },
      mailbox,
    );
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

    // Muitos anexos grandes não cabem num só pedido: lê-se em grupos e juntam-se as leituras.
    const results = [];
    for (const group of batchAttachments(attachments, this.options.maxRequestBytes))
      results.push(
        await extractor.extract({
          from: email.from,
          subject: email.subject,
          date: email.date,
          body: email.body,
          clientName: client.name,
          clientNif: client.nif,
          attachments: group,
        }),
      );
    const extraction = {
      ...results[0],
      actionNeeded: results.some((r) => r.actionNeeded),
      invoices: results.flatMap((r) => r.invoices),
    };

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
