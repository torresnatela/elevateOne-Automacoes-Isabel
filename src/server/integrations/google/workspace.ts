/**
 * O que os agentes fazem na conta Google de alguém. As ferramentas dependem desta
 * interface; a implementação a sério fala com as APIs do Google (google-rest.workspace.ts).
 */
export interface CalendarEvent {
  id: string;
  title: string;
  /** Início e fim: um instante, ou só o dia (`AAAA-MM-DD`) num compromisso de dia inteiro. */
  start: string;
  end: string;
  allDay: boolean;
  attendees: string[];
  meetLink: string | null;
  link: string | null;
  location: string | null;
}

export interface NewCalendarEvent {
  title: string;
  /** Horas de parede no fuso dado: `2026-11-12T15:00`. */
  start: string;
  end: string;
  timeZone: string;
  attendees?: string[];
  description?: string;
  location?: string;
  /** Cria uma videochamada do Meet e junta o link ao convite. */
  withMeet?: boolean;
}

export type CalendarEventPatch = Partial<Omit<NewCalendarEvent, "timeZone" | "withMeet">> & {
  timeZone: string;
};

export interface EmailSummary {
  id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  /** Ainda está por ler. */
  unread: boolean;
}

export interface EmailAttachment {
  /** A parte da mensagem em que vem: é com isto que se vai buscar. */
  partId: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface EmailMessage extends EmailSummary {
  /** O texto da mensagem (cortado, se for muito longo). */
  body: string;
  attachments: EmailAttachment[];
  /** A conversa do Gmail a que pertence. */
  threadId?: string;
  /** O cabeçalho Message-ID: o mesmo em todas as caixas que receberam o email. */
  rfcMessageId?: string;
}

export interface NewEmail {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  /** Para uma resposta: a conversa do Gmail e os cabeçalhos que a prendem ao email original. */
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  /** Os ficheiros que seguem em anexo. */
  attachments?: FileContent[];
}

/** Quanto podem pesar, juntos, os anexos de um email (o Gmail leva 25 MB já codificados). */
export const MAX_EMAIL_ATTACHMENTS_BYTES = 15 * 1024 * 1024;

/** O que é preciso para responder a um email dentro da mesma conversa. */
export interface ReplyTarget {
  threadId: string;
  to: string[];
  cc: string[];
  subject: string;
  inReplyTo: string;
  references: string;
}

export interface Contact {
  name: string;
  emails: string[];
  phones: string[];
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  link: string | null;
  modifiedAt: string | null;
}

/** Um ficheiro descarregado (do Drive, ou um anexo): os bytes e o tipo deles (os do Google vêm exportados). */
export interface FileContent {
  name: string;
  mimeType: string;
  data: Uint8Array;
}

/** O valor de uma célula de uma folha de cálculo. */
export type CellValue = string | number | boolean | null;

export interface SpreadsheetInfo {
  id: string;
  title: string;
  link: string;
  /** Os nomes das folhas (os separadores), pela ordem em que aparecem. */
  sheets: string[];
}

export interface GoogleWorkspace {
  listEvents(range: { from: Date; to: Date; query?: string }): Promise<CalendarEvent[]>;
  getEvent(id: string): Promise<CalendarEvent>;
  createEvent(event: NewCalendarEvent): Promise<CalendarEvent>;
  updateEvent(id: string, patch: CalendarEventPatch): Promise<CalendarEvent>;
  deleteEvent(id: string): Promise<void>;

  searchEmails(query: string, limit: number): Promise<EmailSummary[]>;
  /** Só os ids dos emails que batem na procura (do mais recente para trás), sem os ler. */
  listMessageIds(query: string, limit: number): Promise<string[]>;
  /** A data de chegada (`internalDate`, ms) de cada email, sem os ler: é ela que ordena a caixa. */
  messageDates(ids: string[]): Promise<Map<string, number>>;
  getEmail(id: string): Promise<EmailMessage>;
  sendEmail(email: NewEmail): Promise<{ id: string }>;
  /** A quem e como responder a um email. Com `all`, também a quem estava no Para e em cópia. */
  replyTarget(id: string, all: boolean): Promise<ReplyTarget>;
  getAttachment(emailId: string, partId: string): Promise<FileContent>;

  searchContacts(query: string, limit: number): Promise<Contact[]>;

  searchFiles(query: string, limit: number): Promise<DriveFile[]>;
  /** O conteúdo de um ficheiro. Os Docs e Slides vêm em texto; as folhas de cálculo, em CSV. */
  readFile(id: string): Promise<FileContent>;
  /** Um ficheiro do Drive como segue em anexo: os do Google (Docs, Sheets, Slides) vão em PDF. */
  attachableFile(id: string): Promise<FileContent>;
  /** O nome com que seguiria em anexo e o tamanho, sem o descarregar (`null`: só se sabe ao exportar). */
  attachableInfo(id: string): Promise<{ name: string; size: number | null }>;
  createDocument(title: string, text: string): Promise<{ id: string; link: string }>;

  getSpreadsheet(id: string): Promise<SpreadsheetInfo>;
  /** As células de um intervalo em notação A1 (`2026!A1:D50`, ou só o nome de uma folha). */
  readCells(id: string, range: string): Promise<{ range: string; values: CellValue[][] }>;
  createSpreadsheet(title: string, rows?: CellValue[][]): Promise<{ id: string; link: string }>;
  /** Escreve por cima do intervalo (`replace`) ou junta as linhas ao fim do que lá está (`append`). */
  writeCells(
    id: string,
    range: string,
    values: CellValue[][],
    mode: "replace" | "append",
  ): Promise<{ range: string; rows: number }>;
}

/** As permissões que se pedem ao ligar a conta. */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets",
] as const;
