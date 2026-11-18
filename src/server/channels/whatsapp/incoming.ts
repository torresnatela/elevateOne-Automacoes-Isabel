/** Uma mensagem que chegou pelo WhatsApp, já lida do formato da Evolution API. */
export interface IncomingWhatsapp {
  /** O id da mensagem no WhatsApp (para não a tratar duas vezes). */
  id: string;
  /** O número de quem enviou: só dígitos, com o indicativo. */
  phone: string;
  kind: "text" | "audio" | "image" | "document" | "other";
  /** O texto da mensagem; numa imagem ou num documento, a legenda (se a tiver). */
  text?: string;
  /** O áudio, quando o webhook já o traz em base64. */
  audio?: { base64: string; mimeType: string };
  /** A imagem ou o documento: o tipo, o nome, o tamanho anunciado e, quando o webhook já os traz, os bytes. */
  media?: { mimeType: string; fileName?: string; size?: number; base64?: string };
  /** Enviada para ser vista (ou ouvida) uma só vez: quem a mandou não a quer guardada. */
  viewOnce?: true;
  /** A mensagem como veio, para pedir o ficheiro à Evolution quando não vem no webhook. */
  raw: unknown;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- o webhook lê-se campo a campo */

const digitsOf = (jid: unknown): string | null => {
  if (typeof jid !== "string") return null;
  const user = jid.split("@")[0].split(":")[0];
  return /^\d{8,15}$/.test(user) ? user : null;
};

/** O WhatsApp embrulha algumas mensagens (temporárias, de ver uma vez, documento com legenda). */
const VIEW_ONCE_WRAPPERS = ["viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension"];
const WRAPPERS = ["ephemeralMessage", ...VIEW_ONCE_WRAPPERS, "documentWithCaptionMessage"];

/** O que vem dentro dos embrulhos, e se algum deles era o de ver uma só vez. */
const unwrap = (message: any): { content: any; viewOnce: boolean } => {
  let current = message;
  let viewOnce = false;
  for (let depth = 0; depth < 4; depth++) {
    const wrapper = WRAPPERS.find((name) => current?.[name]?.message);
    if (!wrapper) break;
    viewOnce ||= VIEW_ONCE_WRAPPERS.includes(wrapper);
    current = current[wrapper].message;
  }
  return { content: current ?? {}, viewOnce };
};

/** O tamanho de um ficheiro, que vem como número, como texto ou num objeto Long (`{ low, high }`). */
const sizeOf = (length: unknown): number | undefined => {
  const value =
    typeof length === "object" && length !== null
      ? Number((length as any).high ?? 0) * 2 ** 32 + (Number((length as any).low ?? 0) >>> 0)
      : Number(length);
  return length !== undefined && length !== null && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
};

const captionOf = (part: any): { text?: string } =>
  typeof part?.caption === "string" && part.caption.trim() ? { text: part.caption.trim() } : {};

/**
 * Lê um webhook da Evolution API (evento `messages.upsert`). Devolve `null` para o
 * que não é uma mensagem de uma pessoa para nós: outros eventos, as nossas próprias
 * mensagens, grupos, estados e listas de difusão.
 */
export function parseEvolutionWebhook(payload: unknown): IncomingWhatsapp | null {
  const body = payload as any;
  const event = String(body?.event ?? "")
    .toLowerCase()
    .replace(/_/g, ".");
  if (event !== "messages.upsert") return null;

  const data = Array.isArray(body.data) ? body.data[0] : body.data;
  const key = data?.key;
  if (!key?.id || key.fromMe) return null;

  const jid = String(key.remoteJid ?? "");
  if (jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.endsWith("@newsletter"))
    return null;
  // Com os ids privados (@lid), o número vem à parte.
  const phone =
    (jid.endsWith("@s.whatsapp.net") ? digitsOf(jid) : null) ??
    digitsOf(key.senderPn) ??
    digitsOf(key.remoteJidAlt) ??
    digitsOf(data.senderPn);
  if (!phone) return null;

  const message = data.message ?? {};
  // Com as mensagens temporárias ligadas, tudo vem embrulhado: o texto e o áudio também.
  const { content, viewOnce } = unwrap(message);
  // A marca de ver uma só vez vem no embrulho ou, nas versões mais antigas, na própria mensagem.
  const once =
    viewOnce ||
    [content.imageMessage, content.videoMessage, content.audioMessage].some(
      (part) => part?.viewOnce === true,
    );
  const base = {
    id: String(key.id),
    phone,
    raw: data,
    ...(once ? { viewOnce: true as const } : {}),
  };
  const base64 = message.base64 ?? data.base64;

  const text = content.conversation ?? content.extendedTextMessage?.text;
  if (typeof text === "string" && text.trim()) return { ...base, kind: "text", text: text.trim() };

  if (content.audioMessage)
    return {
      ...base,
      kind: "audio",
      ...(typeof base64 === "string" && base64
        ? { audio: { base64, mimeType: content.audioMessage.mimetype ?? "audio/ogg" } }
        : {}),
    };
  const mediaOf = (part: any, fallbackType: string) => ({
    mimeType: String(part.mimetype ?? fallbackType)
      .split(";")[0]
      .trim(),
    ...(typeof part.fileName === "string" && part.fileName ? { fileName: part.fileName } : {}),
    ...(sizeOf(part.fileLength) !== undefined ? { size: sizeOf(part.fileLength) } : {}),
    ...(typeof base64 === "string" && base64 ? { base64 } : {}),
  });

  if (content.imageMessage)
    return {
      ...base,
      kind: "image",
      ...captionOf(content.imageMessage),
      media: mediaOf(content.imageMessage, "image/jpeg"),
    };
  if (content.documentMessage)
    return {
      ...base,
      kind: "document",
      ...captionOf(content.documentMessage),
      media: mediaOf(content.documentMessage, "application/octet-stream"),
    };
  return { ...base, kind: "other" };
}
