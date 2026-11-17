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
}

export interface EmailMessage extends EmailSummary {
  /** O texto da mensagem (cortado, se for muito longo). */
  body: string;
}

export interface NewEmail {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
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

export interface GoogleWorkspace {
  listEvents(range: { from: Date; to: Date; query?: string }): Promise<CalendarEvent[]>;
  getEvent(id: string): Promise<CalendarEvent>;
  createEvent(event: NewCalendarEvent): Promise<CalendarEvent>;
  updateEvent(id: string, patch: CalendarEventPatch): Promise<CalendarEvent>;
  deleteEvent(id: string): Promise<void>;

  searchEmails(query: string, limit: number): Promise<EmailSummary[]>;
  getEmail(id: string): Promise<EmailMessage>;
  sendEmail(email: NewEmail): Promise<{ id: string }>;

  searchContacts(query: string, limit: number): Promise<Contact[]>;

  searchFiles(query: string, limit: number): Promise<DriveFile[]>;
  createDocument(title: string, text: string): Promise<{ id: string; link: string }>;
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
] as const;
