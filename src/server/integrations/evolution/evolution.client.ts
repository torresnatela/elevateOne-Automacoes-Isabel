import { AppError } from "@/server/lib/errors";

/** Enviar e ir buscar mensagens do WhatsApp. O canal depende desta interface. */
export interface WhatsappMessenger {
  sendText(phone: string, text: string): Promise<void>;
  /** O áudio de uma mensagem recebida (a mensagem como veio no webhook). */
  downloadAudio(rawMessage: unknown): Promise<{ data: Uint8Array; mimeType: string }>;
}

export interface EvolutionConfig {
  /** O endereço da Evolution API, ex.: `http://localhost:8080`. */
  baseUrl: string;
  apiKey: string;
  /** O nome da instância (o número ligado). */
  instance: string;
}

/** A Evolution API (v2): a ponte não oficial para um número de WhatsApp. */
export class EvolutionClient implements WhatsappMessenger {
  constructor(
    private readonly config: EvolutionConfig | null,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): EvolutionClient {
    const { EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE } = env;
    if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY || !EVOLUTION_INSTANCE)
      return new EvolutionClient(null);
    return new EvolutionClient({
      baseUrl: EVOLUTION_API_URL.replace(/\/+$/, ""),
      apiKey: EVOLUTION_API_KEY,
      instance: EVOLUTION_INSTANCE,
    });
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    if (!this.config)
      throw new AppError(
        "O WhatsApp não está configurado (EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE).",
        503,
        "WHATSAPP_NOT_CONFIGURED",
      );
    const { baseUrl, apiKey, instance } = this.config;
    const res = await this.fetchFn(`${baseUrl}/${path}/${encodeURIComponent(instance)}`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: apiKey },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok)
      throw new AppError(
        `A Evolution API recusou o pedido (${res.status}).`,
        502,
        "WHATSAPP_API_ERROR",
      );
    return data;
  }

  async sendText(phone: string, text: string) {
    await this.post("message/sendText", { number: phone, text });
  }

  async downloadAudio(rawMessage: unknown) {
    const data = (await this.post("chat/getBase64FromMediaMessage", {
      message: rawMessage,
      convertToMp4: false,
    })) as { base64?: string; mimetype?: string } | null;
    if (!data?.base64)
      throw new AppError("Não foi possível ir buscar o áudio.", 502, "WHATSAPP_API_ERROR");
    return {
      data: new Uint8Array(Buffer.from(data.base64, "base64")),
      mimeType: data.mimetype ?? "audio/ogg",
    };
  }
}
