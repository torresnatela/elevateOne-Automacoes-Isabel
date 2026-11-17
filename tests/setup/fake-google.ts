import type { GoogleOAuth, GoogleTokens } from "@/server/integrations/google/oauth";
import { GoogleReconnectError } from "@/server/integrations/google/oauth";
import type {
  CalendarEvent,
  CalendarEventPatch,
  Contact,
  DriveFile,
  EmailMessage,
  EmailSummary,
  GoogleWorkspace,
  NewCalendarEvent,
  NewEmail,
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
  sent: NewEmail[] = [];
  documents: Array<{ title: string; text: string }> = [];
  calls: Array<[string, ...unknown[]]> = [];

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
    return this.emails.slice(0, limit).map(({ body: _body, ...summary }) => summary);
  }
  async getEmail(id: string) {
    const email = this.emails.find((e) => e.id === id);
    if (!email) throw new Error("O email não existe.");
    return email;
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
  async createDocument(title: string, text: string) {
    this.documents.push({ title, text });
    return { id: "doc1", link: "https://docs.google.com/document/d/doc1/edit" };
  }
}
