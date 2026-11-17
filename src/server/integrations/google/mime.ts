import type { NewEmail } from "./workspace";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

/** Um valor de cabeçalho numa linha só: sem quebras, não se injetam outros cabeçalhos. */
const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

/** O assunto como o correio o quer quando tem acentos (RFC 2047). */
const encodeHeader = (value: string) =>
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${b64(value)}?=`;

/** A mensagem no formato do correio (RFC 5322), em texto simples UTF-8. */
export function buildMimeMessage(email: NewEmail): string {
  const headers = [
    `To: ${email.to.map(oneLine).join(", ")}`,
    ...(email.cc?.length ? [`Cc: ${email.cc.map(oneLine).join(", ")}`] : []),
    `Subject: ${encodeHeader(oneLine(email.subject))}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  const body = b64(email.body).replace(/(.{76})/g, "$1\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

/** Como a API do Gmail quer a mensagem: base64url. */
export const toBase64Url = (text: string) => Buffer.from(text, "utf8").toString("base64url");

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
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
