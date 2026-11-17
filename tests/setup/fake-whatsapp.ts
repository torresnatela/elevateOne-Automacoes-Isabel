import type { WhatsappMessenger } from "@/server/integrations/evolution/evolution.client";
import type { Transcriber } from "@/server/integrations/openai/openai-transcriber";
import type { InboundMessageRepository } from "@/server/repositories/inbound-message.repository";

export class FakeMessenger implements WhatsappMessenger {
  sent: Array<{ phone: string; text: string }> = [];
  downloads: unknown[] = [];
  failSending = false;

  async sendText(phone: string, text: string) {
    if (this.failSending) throw new Error("a Evolution caiu");
    this.sent.push({ phone, text });
  }
  async downloadAudio(rawMessage: unknown) {
    this.downloads.push(rawMessage);
    return { data: new TextEncoder().encode("áudio descarregado"), mimeType: "audio/ogg" };
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
