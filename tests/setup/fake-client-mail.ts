import type {
  InvoiceExtractor,
  MailExtraction,
  MailToExtract,
} from "@/server/integrations/anthropic/invoice-extractor";
import type {
  ClientMailRepository,
  MailSyncStateRecord,
  NewClientEmail,
  NewInvoice,
} from "@/server/repositories/client-mail.repository";

/** O repositório do agente de faturas em memória. */
export class FakeClientMailRepository implements ClientMailRepository {
  seen = new Set<string>();
  emails: NewClientEmail[] = [];
  invoices: NewInvoice[] = [];
  states = new Map<string, MailSyncStateRecord>();
  locked = false;

  async seenIds(accountId: string, ids: string[]) {
    return new Set(ids.filter((id) => this.seen.has(`${accountId}/${id}`)));
  }
  async markSeen(accountId: string, ids: string[]) {
    for (const id of ids) this.seen.add(`${accountId}/${id}`);
  }
  async hasRfcMessageId(rfc: string) {
    return this.emails.some((e) => e.rfcMessageId === rfc);
  }
  async saveEmail(email: NewClientEmail, invoices: NewInvoice[]) {
    this.emails.push(email);
    this.invoices.push(...invoices);
    this.seen.add(`${email.googleAccountId}/${email.gmailMessageId}`);
    return { invoices: invoices.length };
  }
  async getSyncState(id: string) {
    return this.states.get(id) ?? null;
  }
  async listSyncStates() {
    return [...this.states.values()];
  }
  async setSyncState(state: MailSyncStateRecord) {
    this.states.set(state.googleAccountId, state);
    return true;
  }
  async recordRunError(googleAccountId: string, error: string) {
    const current = this.states.get(googleAccountId);
    this.states.set(googleAccountId, {
      googleAccountId,
      syncedUntil: current?.syncedUntil ?? null,
      startFrom: current?.startFrom ?? null,
      lastRunAt: current?.lastRunAt ?? null,
      lastError: error,
    });
  }
  async tryLock() {
    if (this.locked) return false;
    this.locked = true;
    return true;
  }
  /** Um trinco que ficou por soltar e expirou. */
  expired = false;
  async isLocked() {
    return this.locked;
  }
  async lockState() {
    return this.locked
      ? ("held" as const)
      : this.expired
        ? ("expired" as const)
        : ("free" as const);
  }
  async unlock() {
    this.locked = false;
  }
  async listEmails() {
    return [];
  }
  async listInvoices() {
    return [];
  }
  async findInvoiceSource() {
    return null;
  }
  async updateInvoice() {
    return null;
  }
  async refreshReviewStatus() {
    return null;
  }
}

/** Um extrator que devolve o que se lhe disser, e regista o que leu. */
export class FakeInvoiceExtractor implements InvoiceExtractor {
  calls: MailToExtract[] = [];
  failOn = new Set<string>();
  constructor(private readonly result: (mail: MailToExtract) => MailExtraction) {}
  async extract(mail: MailToExtract) {
    this.calls.push(mail);
    if (this.failOn.has(mail.subject)) throw new Error("O modelo falhou.");
    return this.result(mail);
  }
}
