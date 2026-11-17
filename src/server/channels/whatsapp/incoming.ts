/** Uma mensagem que chegou pelo WhatsApp, já lida do formato da Evolution API. */
export interface IncomingWhatsapp {
  /** O id da mensagem no WhatsApp (para não a tratar duas vezes). */
  id: string;
  /** O número de quem enviou: só dígitos, com o indicativo. */
  phone: string;
  kind: "text" | "audio" | "other";
  text?: string;
  /** O áudio, quando o webhook já o traz em base64. */
  audio?: { base64: string; mimeType: string };
  /** A mensagem como veio, para pedir o áudio à Evolution quando não vem no webhook. */
  raw: unknown;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- o webhook lê-se campo a campo */

const digitsOf = (jid: unknown): string | null => {
  if (typeof jid !== "string") return null;
  const user = jid.split("@")[0].split(":")[0];
  return /^\d{8,15}$/.test(user) ? user : null;
};

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
  const base = { id: String(key.id), phone, raw: data };

  const text = message.conversation ?? message.extendedTextMessage?.text;
  if (typeof text === "string" && text.trim()) return { ...base, kind: "text", text: text.trim() };

  if (message.audioMessage) {
    const base64 = message.base64 ?? data.base64;
    return {
      ...base,
      kind: "audio",
      ...(typeof base64 === "string" && base64
        ? { audio: { base64, mimeType: message.audioMessage.mimetype ?? "audio/ogg" } }
        : {}),
    };
  }
  return { ...base, kind: "other" };
}
