import type { GoogleOAuth, GoogleTokens } from "@/server/integrations/google/oauth";
import { GoogleReconnectError } from "@/server/integrations/google/oauth";
import type {
  CalendarEvent,
  CalendarEventPatch,
  Contact,
  CellValue,
  DriveFile,
  FileContent,
  EmailMessage,
  EmailSummary,
  GoogleWorkspace,
  NewCalendarEvent,
  NewEmail,
  SpreadsheetInfo,
} from "@/server/integrations/google/workspace";
import type {
  GoogleAccount,
  GoogleAccountData,
  GoogleAccountRepository,
} from "@/server/repositories/google-account.repository";

export class FakeGoogleAccountRepository implements GoogleAccountRepository {
  accounts = new Map<string, GoogleAccount>();
  async findByUserId(userId: string) {
    return this.accounts.get(userId) ?? null;
  }
  async listAll() {
    return [...this.accounts.values()].map((a) => ({
      id: `acc-${a.userId}`,
      userId: a.userId,
      email: a.email,
    }));
  }
  async save(account: GoogleAccountData) {
    const saved = { ...account, updatedAt: new Date() };
    this.accounts.set(account.userId, saved);
    return saved;
  }
  async delete(userId: string) {
    this.accounts.delete(userId);
  }
}

/** Um Google de mentira: os refresh tokens em `valid` valem; os outros expiraram. */
export class FakeGoogleOAuth implements GoogleOAuth {
  valid = new Set<string>(["refresh-1"]);
  revoked: string[] = [];
  refreshes = 0;
  /** O que a troca do código devolve. */
  exchange: GoogleTokens = {
    accessToken: "access-0",
    expiresIn: 3600,
    refreshToken: "refresh-1",
    scope: "openid https://www.googleapis.com/auth/userinfo.email",
  };

  authUrl(state: string) {
    return `https://accounts.google.test/auth?state=${state}`;
  }
  async exchangeCode(code: string) {
    if (code !== "good-code") throw new GoogleReconnectError();
    return this.exchange;
  }
  async refresh(refreshToken: string): Promise<GoogleTokens> {
    if (!this.valid.has(refreshToken)) throw new GoogleReconnectError();
    this.refreshes += 1;
    return {
      accessToken: `access-${this.refreshes}`,
      expiresIn: 3600,
      refreshToken: null,
      scope: "",
    };
  }
  async emailOf() {
    return "isabel@escritorio.pt";
  }
  async revoke(token: string) {
    this.revoked.push(token);
  }
}

const event = (id: string, data: NewCalendarEvent | (CalendarEventPatch & { title: string })) => ({
  id,
  title: data.title ?? "",
  start: data.start ?? "",
  end: data.end ?? "",
  allDay: false,
  attendees: data.attendees ?? [],
  meetLink: "withMeet" in data && data.withMeet ? `https://meet.google.com/${id}` : null,
  link: `https://calendar.google.com/event?eid=${id}`,
  location: data.location ?? null,
});

/** Uma conta Google em memória, que regista o que lhe pedem. */
export class FakeGoogleWorkspace implements GoogleWorkspace {
  events: CalendarEvent[] = [];
  emails: EmailMessage[] = [];
  contacts: Contact[] = [];
  files: DriveFile[] = [];
  /** O conteúdo dos anexos, por `idDoEmail/parte`. */
  attachmentContents = new Map<string, FileContent>();
  /** As folhas de cálculo, pelo id. */
  spreadsheets = new Map<string, { title: string; sheets: string[]; values: CellValue[][] }>();
  written: Array<{ id: string; range: string; values: CellValue[][]; mode: string }> = [];
  /** O conteúdo dos ficheiros do Drive, pelo id. */
  contents = new Map<string, FileContent>();
  /** Os ficheiros do Drive como seguem em anexo, pelo id (`exported`: os do Google, que vão em PDF). */
  attachables = new Map<string, FileContent & { exported?: boolean }>();
  sent: NewEmail[] = [];
  documents: Array<{ title: string; text: string }> = [];
  calls: Array<[string, ...unknown[]]> = [];
  /** Os ficheiros e os anexos que foram descarregados, pela ordem. */
  downloads: string[] = [];

  async listEvents(range: { from: Date; to: Date; query?: string }) {
    this.calls.push(["listEvents", range]);
    return this.events;
  }
  async getEvent(id: string) {
    const found = this.events.find((e) => e.id === id);
    if (!found) throw new Error("O compromisso não existe.");
    return found;
  }
  async createEvent(data: NewCalendarEvent) {
    const created = event(`ev${this.events.length + 1}`, data);
    this.events.push(created);
    return created;
  }
  async updateEvent(id: string, patch: CalendarEventPatch) {
    this.calls.push(["updateEvent", id, patch]);
    const index = this.events.findIndex((e) => e.id === id);
    if (index === -1) throw new Error("O compromisso não existe.");
    const current = this.events[index];
    this.events[index] = {
      ...current,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.start !== undefined ? { start: patch.start } : {}),
      ...(patch.end !== undefined ? { end: patch.end } : {}),
      ...(patch.attendees !== undefined ? { attendees: patch.attendees } : {}),
    };
    return this.events[index];
  }
  async deleteEvent(id: string) {
    this.events = this.events.filter((e) => e.id !== id);
  }
  async searchEmails(query: string, limit: number): Promise<EmailSummary[]> {
    this.calls.push(["searchEmails", query, limit]);
    return this.emails
      .slice(0, limit)
      .map(({ body: _body, attachments: _attachments, ...summary }) => summary);
  }
  /** A data de chegada de cada email: a do cabeçalho, ou `arrivals` quando o teste a fixa. */
  arrivals = new Map<string, number>();
  async messageDates(ids: string[]) {
    const dates = new Map<string, number>();
    for (const id of ids) {
      const email = this.emails.find((e) => e.id === id);
      const at = this.arrivals.get(id) ?? (email ? Date.parse(email.date) : NaN);
      if (Number.isFinite(at)) dates.set(id, at);
    }
    return dates;
  }

  async listMessageIds(query: string, limit: number) {
    this.calls.push(["listMessageIds", query, limit]);
    return this.emails.slice(0, limit).map((e) => e.id);
  }

  async getEmail(id: string) {
    const email = this.emails.find((e) => e.id === id);
    if (!email) throw new Error("O email não existe.");
    return email;
  }
  async getAttachment(emailId: string, partId: string) {
    this.downloads.push(`${emailId}/${partId}`);
    const content = this.attachmentContents.get(`${emailId}/${partId}`);
    if (!content) throw new Error("O anexo não existe.");
    return content;
  }
  async replyTarget(id: string, all: boolean) {
    const email = await this.getEmail(id);
    return {
      threadId: `th-${id}`,
      to: [email.from],
      cc: all ? ["ana@cliente.pt"] : [],
      subject: `Re: ${email.subject}`,
      inReplyTo: `<${id}@mail>`,
      references: `<${id}@mail>`,
    };
  }
  async sendEmail(email: NewEmail) {
    this.sent.push(email);
    return { id: `sent${this.sent.length}` };
  }
  async searchContacts(query: string, limit: number) {
    this.calls.push(["searchContacts", query, limit]);
    return this.contacts
      .filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, limit);
  }
  async searchFiles(query: string, limit: number) {
    this.calls.push(["searchFiles", query, limit]);
    return this.files.slice(0, limit);
  }
  async readFile(id: string) {
    this.downloads.push(id);
    const content = this.contents.get(id);
    if (!content) throw new Error("O ficheiro não existe.");
    return content;
  }
  async attachableFile(id: string): Promise<FileContent> {
    const file = this.attachables.get(id);
    if (!file) throw new Error("O ficheiro não existe.");
    return { name: file.name, mimeType: file.mimeType, data: file.data };
  }
  async attachableInfo(id: string) {
    const file = this.attachables.get(id);
    if (!file) throw new Error("O ficheiro não existe.");
    return { name: file.name, size: file.exported ? null : file.data.length };
  }
  async getSpreadsheet(id: string): Promise<SpreadsheetInfo> {
    const sheet = this.spreadsheets.get(id);
    if (!sheet) throw new Error("A folha de cálculo não existe.");
    return { id, title: sheet.title, link: `https://sheets.test/${id}`, sheets: sheet.sheets };
  }
  async readCells(id: string, range: string) {
    this.calls.push(["readCells", id, range]);
    const sheet = this.spreadsheets.get(id);
    if (!sheet) throw new Error("A folha de cálculo não existe.");
    // Um intervalo de linhas («'Folha'!1:201») devolve só essas, como o Sheets.
    const rows = range.match(/!(\d+):(\d+)$/);
    const values = rows ? sheet.values.slice(Number(rows[1]) - 1, Number(rows[2])) : sheet.values;
    return { range, values };
  }
  async createSpreadsheet(title: string, rows: CellValue[][] = []) {
    const id = `sheet${this.spreadsheets.size + 1}`;
    this.spreadsheets.set(id, { title, sheets: ["Folha1"], values: rows });
    return { id, link: `https://sheets.test/${id}` };
  }
  async writeCells(id: string, range: string, values: CellValue[][], mode: "replace" | "append") {
    this.written.push({ id, range, values, mode });
    return { range, rows: values.length };
  }
  async createDocument(title: string, text: string) {
    this.documents.push({ title, text });
    return { id: "doc1", link: "https://docs.google.com/document/d/doc1/edit" };
  }
}
