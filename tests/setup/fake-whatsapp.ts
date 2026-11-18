import type { LlmFileStore } from "@/server/agents/core/types";
import type { WhatsappMessenger } from "@/server/integrations/evolution/evolution.client";
import type { Transcriber } from "@/server/integrations/openai/openai-transcriber";
import { AppError } from "@/server/lib/errors";
import type { InboundMessageRepository } from "@/server/repositories/inbound-message.repository";

export class FakeMessenger implements WhatsappMessenger {
  sent: Array<{ phone: string; text: string }> = [];
  downloads: unknown[] = [];
  /** O limite de tamanho pedido em cada ida buscar um ficheiro. */
  limits: Array<number | undefined> = [];
  failSending = false;
  /** O que a Evolution devolve quando se vai buscar o ficheiro de uma mensagem. */
  media = { data: new TextEncoder().encode("áudio descarregado"), mimeType: "audio/ogg" };

  async sendText(phone: string, text: string) {
    if (this.failSending) throw new Error("a Evolution caiu");
    this.sent.push({ phone, text });
  }
  async downloadMedia(rawMessage: unknown, options: { maxBytes?: number } = {}) {
    this.downloads.push(rawMessage);
    this.limits.push(options.maxBytes);
    // Como a Evolution a sério: pára de ler quando o ficheiro passa do limite pedido.
    if (options.maxBytes !== undefined && this.media.data.length > options.maxBytes)
      throw new AppError("O ficheiro é grande demais.", 413, "WHATSAPP_MEDIA_TOO_LARGE");
    return this.media;
  }
}

/** Os ficheiros entregues ao modelo, em memória: dá um id a cada um e regista o que apagou. */
export class FakeLlmFileStore implements LlmFileStore {
  uploaded: Array<{ id: string; mimeType: string; fileName: string; bytes: number }> = [];
  deleted: string[] = [];
  failDeleting = false;

  async upload(file: { data: Uint8Array; mimeType: string; fileName: string }) {
    const id = `file-${this.uploaded.length + 1}`;
    this.uploaded.push({
      id,
      mimeType: file.mimeType,
      fileName: file.fileName,
      bytes: file.data.length,
    });
    return id;
  }
  async delete(fileId: string) {
    if (this.failDeleting) throw new Error("a API dos ficheiros caiu");
    this.deleted.push(fileId);
  }
}

/** «Transcreve» devolvendo o texto que lhe derem; guarda os áudios que recebeu. */
export class FakeTranscriber implements Transcriber {
  heard: string[] = [];
  constructor(public says = "marca uma reunião com o João amanhã às 15h") {}
  async transcribe(audio: { data: Uint8Array; mimeType: string }) {
    this.heard.push(new TextDecoder().decode(audio.data));
    return this.says;
  }
}

export class FakeInboundMessageRepository implements InboundMessageRepository {
  seen = new Set<string>();
  async claim(id: string) {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    return true;
  }
}

/** Um webhook `messages.upsert` da Evolution API. */
export function webhook(
  message: Record<string, unknown>,
  key: Record<string, unknown> = {},
  event = "messages.upsert",
) {
  return {
    event,
    instance: "escritorio",
    data: {
      key: { remoteJid: "351912345678@s.whatsapp.net", fromMe: false, id: "MSG1", ...key },
      pushName: "Isabel",
      message,
      messageTimestamp: 1794300000,
    },
  };
}
