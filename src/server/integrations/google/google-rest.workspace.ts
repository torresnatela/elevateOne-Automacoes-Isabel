import { randomUUID } from "node:crypto";
import { AppError } from "@/server/lib/errors";
import {
  buildMimeMessage,
  extractBody,
  findPart,
  listAttachments,
  mimeBoundary,
  replyHeaders,
  toBase64Url,
} from "./mime";
import { MAX_EMAIL_ATTACHMENTS_BYTES } from "./workspace";
import type {
  CellValue,
  CalendarEvent,
  CalendarEventPatch,
  Contact,
  DriveFile,
  FileContent,
  EmailMessage,
  EmailSummary,
  GoogleWorkspace,
  NewCalendarEvent,
  NewEmail,
  ReplyTarget,
  SpreadsheetInfo,
} from "./workspace";

export type Fetch = typeof fetch;

/** Quanto do texto de um email vai para o modelo. */
const MAX_EMAIL_BODY = 12_000;

/** O maior ficheiro do Drive que se descarrega para ler. */
export const MAX_DRIVE_FILE_BYTES = 10 * 1024 * 1024;

/** Os ficheiros do próprio Google não se descarregam: exportam-se, cada um para o seu formato de texto. */
const DRIVE_EXPORTS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
};

const CALENDAR = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
/** Por onde seguem as mensagens grandes (com anexos): o corpo é a própria mensagem, não um JSON. */
const GMAIL_UPLOAD = "https://gmail.googleapis.com/upload/gmail/v1/users/me";
const PEOPLE = "https://people.googleapis.com/v1";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const DOCS = "https://docs.googleapis.com/v1/documents";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";

/**
 * O que o Google responde a um pedido que não existe ou está mal feito (um id errado, um
 * intervalo inválido): é um erro de quem pediu, que se corrige a pedir de outra maneira.
 */
const CALLER_ERRORS: Record<number, number> = { 400: 422, 404: 404, 410: 404 };

/** A API do Google respondeu com erro: de quem pediu (4xx) ou uma avaria (502). */
export class GoogleApiError extends AppError {
  constructor(
    readonly googleStatus: number,
    detail: string,
  ) {
    super(
      `O Google recusou o pedido (${googleStatus}): ${detail}`,
      CALLER_ERRORS[googleStatus] ?? 502,
      "GOOGLE_API_ERROR",
    );
  }
}

/**
 * A conta está ligada, mas sem a permissão que este pedido exige (foi ligada antes de a
 * pedirmos, ou a pessoa não a deu). Resolve-se na página das integrações, não a repetir.
 */
export class GoogleMissingScopeError extends AppError {
  constructor(connectUrl?: string | null) {
    super(
      "Falta uma permissão na conta Google para fazer isto. " +
        (connectUrl
          ? `Para a dar: abrir ${connectUrl} e escolher «Dar as permissões».`
          : "Para a dar: na página Integrações, escolher «Dar as permissões»."),
      409,
      "GOOGLE_MISSING_SCOPE",
    );
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- as respostas do Google lêem-se campo a campo */
type Json = any;

const lacksScope = (status: number, data: Json): boolean =>
  status === 403 &&
  ((data?.error?.details ?? []).some(
    (d: Json) => d?.reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
  ) ||
    /insufficient authentication scopes/i.test(String(data?.error?.message ?? "")));

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
  unread: (m.labelIds ?? []).includes("UNREAD"),
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
    /** O endereço da página das integrações, para o erro de permissão em falta dizer onde se dá. */
    private readonly connectUrl: string | null = null,
  ) {}

  /** O erro de uma resposta que o Google recusou. */
  private async failure(res: Response): Promise<AppError> {
    const data = await res.json().catch(() => null);
    if (lacksScope(res.status, data)) return new GoogleMissingScopeError(this.connectUrl);
    return new GoogleApiError(res.status, data?.error?.message ?? res.statusText);
  }

  private async call(
    url: string,
    init: {
      method?: string;
      query?: Record<string, string | undefined>;
      body?: unknown;
      /** Um corpo que não é JSON, com o tipo dele. */
      raw?: { contentType: string; body: string };
    } = {},
  ): Promise<Json> {
    const target = new URL(url);
    for (const [key, value] of Object.entries(init.query ?? {}))
      if (value !== undefined) target.searchParams.set(key, value);
    const res = await this.fetchFn(target, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        ...(init.raw
          ? { "content-type": init.raw.contentType }
          : init.body !== undefined
            ? { "content-type": "application/json" }
            : {}),
      },
      body: init.raw?.body ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    });
    if (res.status === 204) return null;
    if (!res.ok) throw await this.failure(res);
    return res.json().catch(() => null);
  }

  /** Como `call`, para o que não é JSON: devolve os bytes. */
  private async download(url: string, query: Record<string, string>): Promise<Uint8Array> {
    const target = new URL(url);
    for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
    const res = await this.fetchFn(target, {
      headers: { authorization: `Bearer ${await this.accessToken()}` },
    });
    if (!res.ok) throw await this.failure(res);
    return new Uint8Array(await res.arrayBuffer());
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

  async messageDates(ids: string[]): Promise<Map<string, number>> {
    const dates = new Map<string, number>();
    // Poucos pedidos de cada vez, para não bater no limite por segundo do Gmail.
    for (let i = 0; i < ids.length; i += 10)
      await Promise.all(
        ids.slice(i, i + 10).map(async (id) => {
          // Um email cuja data não se consegue ler fica sem ela (vai para o fim da fila e é
          // lido à parte): não pode impedir a leitura do resto da caixa.
          try {
            const m = await this.call(`${GMAIL}/messages/${encodeURIComponent(id)}`, {
              // `minimal` não promete o internalDate; `metadata` traz o recurso Message com ele
              // (e `fields` corta a resposta a só isso).
              query: { format: "metadata", fields: "id,internalDate" },
            });
            const at = Number(m?.internalDate);
            if (Number.isFinite(at)) dates.set(id, at);
          } catch {
            // Sem data: ordena-se no fim.
          }
        }),
      );
    return dates;
  }

  async listMessageIds(query: string, limit: number): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.call(`${GMAIL}/messages`, {
        query: { q: query, maxResults: String(Math.min(500, limit - ids.length)), pageToken },
      });
      ids.push(...(page.messages ?? []).map((m: Json) => m.id as string));
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken && ids.length < limit);
    return ids.slice(0, limit);
  }

  async getEmail(id: string): Promise<EmailMessage> {
    const message = await this.call(`${GMAIL}/messages/${encodeURIComponent(id)}`, {
      query: { format: "full" },
    });
    const body = extractBody(message.payload ?? {});
    return {
      ...toSummary(message),
      body: body.length > MAX_EMAIL_BODY ? `${body.slice(0, MAX_EMAIL_BODY)}\n[…cortado]` : body,
      attachments: listAttachments(message.payload ?? {}),
      threadId: message.threadId,
      rfcMessageId: header(message, "Message-ID") || undefined,
    };
  }

  async getAttachment(emailId: string, partId: string): Promise<FileContent> {
    const url = `${GMAIL}/messages/${encodeURIComponent(emailId)}`;
    const message = await this.call(url, { query: { format: "full" } });
    const part = findPart(message.payload ?? {}, partId);
    if (!part)
      throw new AppError("Esse email não tem esse anexo.", 404, "EMAIL_ATTACHMENT_NOT_FOUND");
    if ((part.body?.size ?? 0) > MAX_DRIVE_FILE_BYTES)
      throw new AppError(
        "O anexo é grande demais para ler (o máximo são 10 MB).",
        413,
        "GOOGLE_FILE_TOO_LARGE",
      );
    // Os anexos pequenos vêm na própria mensagem; os outros, num pedido à parte.
    const data =
      part.body?.data ??
      (await this.call(`${url}/attachments/${encodeURIComponent(part.body?.attachmentId ?? "")}`))
        .data;
    return {
      name: part.filename ?? "anexo",
      mimeType: part.mimeType ?? "application/octet-stream",
      data: new Uint8Array(Buffer.from(String(data ?? ""), "base64url")),
    };
  }

  async replyTarget(id: string, all: boolean): Promise<ReplyTarget> {
    const profile = await this.call(`${GMAIL}/profile`);
    const url = new URL(`${GMAIL}/messages/${encodeURIComponent(id)}`);
    url.searchParams.set("format", "metadata");
    for (const name of ["From", "Reply-To", "To", "Cc", "Subject", "Message-ID", "References"])
      url.searchParams.append("metadataHeaders", name);
    const message = await this.call(url.toString());
    return {
      threadId: message.threadId,
      ...replyHeaders(
        {
          from: header(message, "From"),
          replyTo: header(message, "Reply-To"),
          to: header(message, "To"),
          cc: header(message, "Cc"),
          subject: header(message, "Subject"),
          messageId: header(message, "Message-ID"),
          references: header(message, "References"),
        },
        String(profile.emailAddress ?? ""),
        all,
      ),
    };
  }

  async sendEmail(email: NewEmail) {
    if (email.attachments?.length) return this.uploadEmail(email);
    const data = await this.call(`${GMAIL}/messages/send`, {
      method: "POST",
      body: {
        raw: toBase64Url(buildMimeMessage(email)),
        ...(email.threadId ? { threadId: email.threadId } : {}),
      },
    });
    return { id: data.id as string };
  }

  /**
   * Uma mensagem com anexos não cabe num pedido JSON: segue pelo endereço de upload, em duas
   * partes — a conversa a que pertence e a mensagem tal como o correio a lê.
   */
  private async uploadEmail(email: NewEmail) {
    const boundary = mimeBoundary();
    const data = await this.call(`${GMAIL_UPLOAD}/messages/send`, {
      method: "POST",
      query: { uploadType: "multipart" },
      raw: {
        contentType: `multipart/related; boundary="${boundary}"`,
        body:
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
          `${JSON.stringify(email.threadId ? { threadId: email.threadId } : {})}\r\n` +
          `--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n` +
          `${buildMimeMessage(email)}\r\n--${boundary}--`,
      },
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

  async readFile(id: string): Promise<FileContent> {
    const url = `${DRIVE}/${encodeURIComponent(id)}`;
    const file = await this.call(url, {
      query: { fields: "id,name,mimeType,size", supportsAllDrives: "true" },
    });
    const exportAs = DRIVE_EXPORTS[file.mimeType];
    if (exportAs) {
      const data = await this.download(`${url}/export`, { mimeType: exportAs });
      return { name: file.name, mimeType: exportAs, data };
    }
    if (String(file.mimeType).startsWith("application/vnd.google-apps."))
      throw new AppError(
        "Isto não é um ficheiro que se possa ler (é uma pasta, um formulário ou parecido).",
        415,
        "GOOGLE_FILE_NOT_READABLE",
      );
    if (Number(file.size ?? 0) > MAX_DRIVE_FILE_BYTES)
      throw new AppError(
        "O ficheiro é grande demais para ler (o máximo são 10 MB).",
        413,
        "GOOGLE_FILE_TOO_LARGE",
      );
    const data = await this.download(url, { alt: "media", supportsAllDrives: "true" });
    return { name: file.name, mimeType: file.mimeType, data };
  }

  /** O que se sabe de um ficheiro do Drive para o anexar: os do Google exportam-se em PDF. */
  private async attachable(id: string) {
    const url = `${DRIVE}/${encodeURIComponent(id)}`;
    const file = await this.call(url, {
      query: { fields: "id,name,mimeType,size", supportsAllDrives: "true" },
    });
    const native = String(file.mimeType).startsWith("application/vnd.google-apps.");
    if (native && !DRIVE_EXPORTS[file.mimeType])
      throw new AppError(
        "Isto não é um ficheiro que se possa anexar (é uma pasta, um formulário ou parecido).",
        415,
        "GOOGLE_FILE_NOT_ATTACHABLE",
      );
    return {
      url,
      native,
      name: native ? `${file.name}.pdf` : String(file.name),
      mimeType: native ? "application/pdf" : String(file.mimeType),
      size: native ? null : Number(file.size ?? 0),
    };
  }

  async attachableInfo(id: string) {
    const { name, size } = await this.attachable(id);
    return { name, size };
  }

  async attachableFile(id: string): Promise<FileContent> {
    const file = await this.attachable(id);
    if ((file.size ?? 0) > MAX_EMAIL_ATTACHMENTS_BYTES)
      throw new AppError(
        "O ficheiro é grande demais para seguir em anexo (o máximo são 15 MB).",
        413,
        "GOOGLE_FILE_TOO_LARGE",
      );
    const data = file.native
      ? await this.download(`${file.url}/export`, { mimeType: "application/pdf" })
      : await this.download(file.url, { alt: "media", supportsAllDrives: "true" });
    return { name: file.name, mimeType: file.mimeType, data };
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

  async getSpreadsheet(id: string): Promise<SpreadsheetInfo> {
    const data = await this.call(`${SHEETS}/${encodeURIComponent(id)}`, {
      query: { fields: "spreadsheetId,properties.title,spreadsheetUrl,sheets.properties.title" },
    });
    return {
      id: data.spreadsheetId,
      title: data.properties?.title ?? "(sem título)",
      link: data.spreadsheetUrl,
      sheets: (data.sheets ?? []).map((s: Json) => s.properties?.title).filter(Boolean),
    };
  }

  private valuesUrl(id: string, range: string, suffix = "") {
    return `${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}${suffix}`;
  }

  async readCells(id: string, range: string) {
    const data = await this.call(this.valuesUrl(id, range));
    return { range: data.range as string, values: (data.values ?? []) as CellValue[][] };
  }

  async createSpreadsheet(title: string, rows: CellValue[][] = []) {
    const created = await this.call(SHEETS, { method: "POST", body: { properties: { title } } });
    const id = created.spreadsheetId as string;
    if (rows.length > 0) await this.writeCells(id, "A1", rows, "replace");
    return { id, link: created.spreadsheetUrl as string };
  }

  async writeCells(id: string, range: string, values: CellValue[][], mode: "replace" | "append") {
    // USER_ENTERED: o Sheets lê «12/11/2026» como data e «40,50» como número, como se fossem escritos à mão.
    if (mode === "append") {
      const data = await this.call(this.valuesUrl(id, range, ":append"), {
        method: "POST",
        query: { valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS" },
        body: { values },
      });
      return {
        range: (data.updates?.updatedRange ?? range) as string,
        rows: (data.updates?.updatedRows ?? values.length) as number,
      };
    }
    const data = await this.call(this.valuesUrl(id, range), {
      method: "PUT",
      query: { valueInputOption: "USER_ENTERED" },
      body: { values },
    });
    return {
      range: (data.updatedRange ?? range) as string,
      rows: (data.updatedRows ?? values.length) as number,
    };
  }
}
