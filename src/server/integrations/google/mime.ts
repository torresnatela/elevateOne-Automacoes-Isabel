import { randomBytes } from "node:crypto";
import type { EmailAttachment, FileContent, NewEmail, ReplyTarget } from "./workspace";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

/** Um valor de cabeçalho numa linha só: sem quebras, não se injetam outros cabeçalhos. */
const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

/**
 * Uma lista de ids em várias linhas quando é longa (as continuações começam por espaço):
 * numa conversa de muitos emails, uma linha só passava do que o correio aceita.
 */
const MAX_HEADER_LINE = 900;
const folded = (value: string) =>
  value
    .split(/\s+/)
    .reduce<string[]>((lines, id) => {
      const last = lines.at(-1);
      if (last !== undefined && last.length + 1 + id.length <= MAX_HEADER_LINE)
        lines[lines.length - 1] = `${last} ${id}`;
      else lines.push(id);
      return lines;
    }, [])
    .join("\r\n ");

/** O assunto como o correio o quer quando tem acentos (RFC 2047). */
const encodeHeader = (value: string) =>
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${b64(value)}?=`;

/** O base64 em linhas de 76 caracteres, como o correio o quer. */
const wrapped = (base64: string) => base64.match(/.{1,76}/g)?.join("\r\n") ?? "";

/** O separador das partes de uma mensagem: ao acaso, para não coincidir com o conteúdo. */
export const mimeBoundary = () => `=_${randomBytes(12).toString("hex")}`;

const MAX_ATTACHMENT_NAME = 120;

/** Um nome comprido encurtado sem perder a extensão nem partir um carácter a meio. */
const shortName = (name: string) => {
  const chars = [...name];
  if (chars.length <= MAX_ATTACHMENT_NAME) return name;
  const extension = /\.[^.\s]{1,10}$/.exec(name)?.[0] ?? "";
  return chars.slice(0, MAX_ATTACHMENT_NAME - [...extension].length).join("") + extension;
};

/** Um anexo como parte de uma mensagem: o nome não consegue partir nem juntar cabeçalhos. */
function attachmentPart(file: FileContent): string {
  const name = shortName(oneLine(file.name).toWellFormed().replace(/["\\]/g, "'")) || "anexo";
  const ascii = /^[\x20-\x7e]*$/.test(name);
  const type = /^[\w.+-]+\/[\w.+-]+$/.test(file.mimeType)
    ? file.mimeType
    : "application/octet-stream";
  // Com acentos, o nome vai nos dois formatos que os programas de correio leem (RFC 2047 e 2231).
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return [
    `Content-Type: ${type}; name="${ascii ? name : encodeHeader(name)}"`,
    `Content-Disposition: attachment; ${ascii ? `filename="${name}"` : `filename*=UTF-8''${encoded}`}`,
    "Content-Transfer-Encoding: base64",
    "",
    wrapped(Buffer.from(file.data).toString("base64")),
  ].join("\r\n");
}

/** A mensagem no formato do correio (RFC 5322): texto simples UTF-8 e, se os houver, os anexos. */
export function buildMimeMessage(email: NewEmail): string {
  const headers = [
    `To: ${email.to.map(oneLine).join(", ")}`,
    ...(email.cc?.length ? [`Cc: ${email.cc.map(oneLine).join(", ")}`] : []),
    `Subject: ${encodeHeader(oneLine(email.subject))}`,
    ...(email.inReplyTo ? [`In-Reply-To: ${oneLine(email.inReplyTo)}`] : []),
    ...(email.references ? [`References: ${folded(oneLine(email.references))}`] : []),
    "MIME-Version: 1.0",
  ];
  const text = [
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapped(b64(email.body)),
  ].join("\r\n");
  if (!email.attachments?.length) return `${headers.join("\r\n")}\r\n${text}`;

  const boundary = mimeBoundary();
  const parts = [text, ...email.attachments.map(attachmentPart)];
  return (
    `${[...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`].join("\r\n")}\r\n\r\n` +
    parts.map((part) => `--${boundary}\r\n${part}\r\n`).join("") +
    `--${boundary}--\r\n`
  );
}

/** Como a API do Gmail quer a mensagem: base64url. */
export const toBase64Url = (text: string) => Buffer.from(text, "utf8").toString("base64url");

export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
}

/** Os cabeçalhos de um email que contam para lhe responder. */
export interface ReplySource {
  from: string;
  replyTo: string;
  to: string;
  cc: string;
  subject: string;
  messageId: string;
  references: string;
}

/** Um apóstrofo faz parte do endereço (o'brien@…); à volta dele, são só plicas. */
const ADDRESS = /[^\s<>,;:"()]+@[^\s<>,;:"()]+/;
const unquoted = (address: string) => address.replace(/^'+|'+$/g, "");

/**
 * Os endereços de um cabeçalho («Nome <a@b.pt>, c@d.pt»), em minúsculas e sem repetir.
 * O nome a mostrar não conta, mesmo que tenha lá um endereço escrito: vale o que está
 * entre `<>` e, sem isso, o endereço solto.
 */
const addressesOf = (header: string): string[] => [
  ...new Set(
    header
      .replace(/"(?:[^"\\]|\\.)*"/g, " ")
      .replace(/\([^()]*\)/g, " ")
      .split(/[,;]/)
      .map((entry) => (entry.match(/<([^<>]*)>/)?.[1] ?? entry).match(ADDRESS)?.[0])
      .map((address) => (address ? unquoted(address).toLowerCase() : ""))
      .filter((address) => address.includes("@")),
  ),
];

/**
 * A quem vai a resposta a um email, e os cabeçalhos que a prendem à conversa. Vai para
 * quem escreveu (ou para o endereço de resposta que indicou); com `all`, os outros
 * destinatários seguem em cópia, menos o próprio. A resposta a um email que a própria
 * pessoa enviou vai para quem o recebeu, como no Gmail.
 */
export function replyHeaders(
  original: ReplySource,
  self: string,
  all: boolean,
): Omit<ReplyTarget, "threadId"> {
  const me = self.toLowerCase();
  const sender = addressesOf(original.replyTo || original.from);
  const recipients = addressesOf(original.to).filter((a) => a !== me);
  const ownEmail = sender.length > 0 && sender.every((a) => a === me);
  const to = ownEmail && recipients.length > 0 ? recipients : sender;
  const skip = new Set([me, ...to]);
  const subject = original.subject.trim();
  return {
    to,
    cc: all ? addressesOf(`${original.to}, ${original.cc}`).filter((a) => !skip.has(a)) : [],
    subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
    inReplyTo: original.messageId,
    references: [original.references.trim(), original.messageId].filter(Boolean).join(" "),
  };
}

/** Os anexos de uma mensagem do Gmail: as partes que têm nome de ficheiro. */
export function listAttachments(payload: GmailPart): EmailAttachment[] {
  const own: EmailAttachment[] =
    payload.filename && payload.partId !== undefined
      ? [
          {
            partId: payload.partId,
            fileName: payload.filename,
            mimeType: payload.mimeType ?? "application/octet-stream",
            size: payload.body?.size ?? 0,
          },
        ]
      : [];
  return [...own, ...(payload.parts ?? []).flatMap(listAttachments)];
}

/** A parte de uma mensagem com um dado id (um anexo). */
export function findPart(payload: GmailPart, partId: string): GmailPart | null {
  if (payload.partId === partId && payload.filename) return payload;
  for (const child of payload.parts ?? []) {
    const found = findPart(child, partId);
    if (found) return found;
  }
  return null;
}

const decode = (data: string) => Buffer.from(data, "base64url").toString("utf8");

const stripHtml = (html: string) =>
  html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();

/** O texto de uma mensagem do Gmail: a parte em texto simples ou, sem ela, o HTML sem etiquetas. */
export function extractBody(payload: GmailPart): string {
  const find = (part: GmailPart, mimeType: string): string | null => {
    if (part.mimeType === mimeType && part.body?.data) return decode(part.body.data);
    for (const child of part.parts ?? []) {
      const found = find(child, mimeType);
      if (found !== null) return found;
    }
    return null;
  };
  const plain = find(payload, "text/plain");
  if (plain !== null) return plain.trim();
  const html = find(payload, "text/html");
  return html !== null ? stripHtml(html) : "";
}
