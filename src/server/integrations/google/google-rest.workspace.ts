import { randomUUID } from "node:crypto";
import { AppError } from "@/server/lib/errors";
import { buildMimeMessage, extractBody, toBase64Url } from "./mime";
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
} from "./workspace";

export type Fetch = typeof fetch;

/** Quanto do texto de um email vai para o modelo. */
const MAX_EMAIL_BODY = 12_000;

const CALENDAR = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const PEOPLE = "https://people.googleapis.com/v1";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const DOCS = "https://docs.googleapis.com/v1/documents";

/** A API do Google respondeu com erro. */
export class GoogleApiError extends AppError {
  constructor(
    readonly googleStatus: number,
    detail: string,
  ) {
    super(`O Google recusou o pedido (${googleStatus}): ${detail}`, 502, "GOOGLE_API_ERROR");
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- as respostas do Google lêem-se campo a campo */
type Json = any;

const toEvent = (e: Json): CalendarEvent => ({
  id: e.id,
  title: e.summary ?? "(sem título)",
  start: e.start?.dateTime ?? e.start?.date ?? "",
  end: e.end?.dateTime ?? e.end?.date ?? "",
  allDay: !e.start?.dateTime,
  attendees: (e.attendees ?? []).map((a: Json) => a.email).filter(Boolean),
  meetLink:
    e.hangoutLink ??
    e.conferenceData?.entryPoints?.find((p: Json) => p.entryPointType === "video")?.uri ??
    null,
  link: e.htmlLink ?? null,
  location: e.location ?? null,
});

const eventBody = (event: Partial<NewCalendarEvent> & { timeZone: string }) => ({
  ...(event.title !== undefined ? { summary: event.title } : {}),
  ...(event.description !== undefined ? { description: event.description } : {}),
  ...(event.location !== undefined ? { location: event.location } : {}),
  ...(event.start !== undefined
    ? { start: { dateTime: withSeconds(event.start), timeZone: event.timeZone } }
    : {}),
  ...(event.end !== undefined
    ? { end: { dateTime: withSeconds(event.end), timeZone: event.timeZone } }
    : {}),
  ...(event.attendees !== undefined
    ? { attendees: event.attendees.map((email) => ({ email })) }
    : {}),
});

const withSeconds = (local: string) => (local.length === 16 ? `${local}:00` : local);

const header = (message: Json, name: string): string =>
  message.payload?.headers?.find((h: Json) => h.name.toLowerCase() === name.toLowerCase())?.value ??
  "";

const toSummary = (m: Json): EmailSummary => ({
  id: m.id,
  from: header(m, "From"),
  to: header(m, "To"),
  subject: header(m, "Subject"),
  date: header(m, "Date"),
  snippet: m.snippet ?? "",
});

const toContact = (person: Json): Contact => ({
  name: person.names?.[0]?.displayName ?? "",
  emails: (person.emailAddresses ?? []).map((e: Json) => e.value).filter(Boolean),
  phones: (person.phoneNumbers ?? []).map((p: Json) => p.value).filter(Boolean),
});

/** As APIs do Google (Agenda, Gmail, Contactos, Drive, Docs) por HTTP, com o token de quem ligou a conta. */
export class GoogleRestWorkspace implements GoogleWorkspace {
  constructor(
    private readonly accessToken: () => Promise<string>,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  private async call(
    url: string,
    init: { method?: string; query?: Record<string, string | undefined>; body?: unknown } = {},
  ): Promise<Json> {
    const target = new URL(url);
    for (const [key, value] of Object.entries(init.query ?? {}))
      if (value !== undefined) target.searchParams.set(key, value);
    const res = await this.fetchFn(target, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new GoogleApiError(res.status, data?.error?.message ?? res.statusText);
    return data;
  }

  async listEvents(range: { from: Date; to: Date; query?: string }) {
    const data = await this.call(CALENDAR, {
      query: {
        timeMin: range.from.toISOString(),
        timeMax: range.to.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "100",
        q: range.query,
      },
    });
    return (data.items ?? []).filter((e: Json) => e.status !== "cancelled").map(toEvent);
  }

  async getEvent(id: string) {
    return toEvent(await this.call(`${CALENDAR}/${encodeURIComponent(id)}`));
  }

  async createEvent(event: NewCalendarEvent) {
    const data = await this.call(CALENDAR, {
      method: "POST",
      query: { sendUpdates: "all", conferenceDataVersion: event.withMeet ? "1" : undefined },
      body: {
        ...eventBody(event),
        ...(event.withMeet
          ? {
              conferenceData: {
                createRequest: {
                  requestId: randomUUID(),
                  conferenceSolutionKey: { type: "hangoutsMeet" },
                },
              },
            }
          : {}),
      },
    });
    return toEvent(data);
  }

  async updateEvent(id: string, patch: CalendarEventPatch) {
    const data = await this.call(`${CALENDAR}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      query: { sendUpdates: "all" },
      body: eventBody(patch),
    });
    return toEvent(data);
  }

  async deleteEvent(id: string) {
    await this.call(`${CALENDAR}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      query: { sendUpdates: "all" },
    });
  }

  async searchEmails(query: string, limit: number) {
    const list = await this.call(`${GMAIL}/messages`, {
      query: { q: query, maxResults: String(limit) },
    });
    const ids: string[] = (list.messages ?? []).map((m: Json) => m.id);
    const messages = await Promise.all(
      ids.map((id) => {
        const url = new URL(`${GMAIL}/messages/${encodeURIComponent(id)}`);
        url.searchParams.set("format", "metadata");
        for (const name of ["From", "To", "Subject", "Date"])
          url.searchParams.append("metadataHeaders", name);
        return this.call(url.toString());
      }),
    );
    return messages.map(toSummary);
  }

  async getEmail(id: string): Promise<EmailMessage> {
    const message = await this.call(`${GMAIL}/messages/${encodeURIComponent(id)}`, {
      query: { format: "full" },
    });
    const body = extractBody(message.payload ?? {});
    return {
      ...toSummary(message),
      body: body.length > MAX_EMAIL_BODY ? `${body.slice(0, MAX_EMAIL_BODY)}\n[…cortado]` : body,
    };
  }

  async sendEmail(email: NewEmail) {
    const data = await this.call(`${GMAIL}/messages/send`, {
      method: "POST",
      body: { raw: toBase64Url(buildMimeMessage(email)) },
    });
    return { id: data.id as string };
  }

  async searchContacts(query: string, limit: number) {
    const readMask = "names,emailAddresses,phoneNumbers";
    const pageSize = String(Math.min(limit, 30));
    const [saved, others] = await Promise.all([
      this.call(`${PEOPLE}/people:searchContacts`, { query: { query, readMask, pageSize } }),
      this.call(`${PEOPLE}/otherContacts:search`, { query: { query, readMask, pageSize } }),
    ]);
    const seen = new Set<string>();
    const contacts: Contact[] = [];
    for (const result of [...(saved.results ?? []), ...(others.results ?? [])]) {
      const contact = toContact(result.person ?? {});
      const key = `${contact.name}|${contact.emails.join(",")}|${contact.phones.join(",")}`;
      if ((!contact.name && contact.emails.length === 0) || seen.has(key)) continue;
      seen.add(key);
      contacts.push(contact);
    }
    return contacts.slice(0, limit);
  }

  async searchFiles(query: string, limit: number): Promise<DriveFile[]> {
    const escaped = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const data = await this.call(DRIVE, {
      query: {
        q: `(name contains '${escaped}' or fullText contains '${escaped}') and trashed = false`,
        fields: "files(id,name,mimeType,webViewLink,modifiedTime)",
        orderBy: "modifiedTime desc",
        pageSize: String(limit),
      },
    });
    return (data.files ?? []).map((f: Json) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      link: f.webViewLink ?? null,
      modifiedAt: f.modifiedTime ?? null,
    }));
  }

  async createDocument(title: string, text: string) {
    const doc = await this.call(DOCS, { method: "POST", body: { title } });
    const id = doc.documentId as string;
    if (text) {
      await this.call(`${DOCS}/${encodeURIComponent(id)}:batchUpdate`, {
        method: "POST",
        body: { requests: [{ insertText: { location: { index: 1 }, text } }] },
      });
    }
    return { id, link: `https://docs.google.com/document/d/${id}/edit` };
  }
}
