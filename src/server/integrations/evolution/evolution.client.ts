import { AppError } from "@/server/lib/errors";

/** Enviar e ir buscar mensagens do WhatsApp. O canal depende desta interface. */
export interface WhatsappMessenger {
  sendText(phone: string, text: string): Promise<void>;
  /** O ficheiro de uma mensagem recebida: imagem ou documento (a mensagem como veio no webhook). */
  downloadMedia(
    rawMessage: unknown,
    options?: { maxBytes?: number },
  ): Promise<{ data: Uint8Array; mimeType: string }>;
}

/** Quanto se espera pela Evolution: a enviar um texto, e a ir buscar um ficheiro. */
const SEND_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

const tooLarge = () => new AppError("O ficheiro é grande demais.", 413, "WHATSAPP_MEDIA_TOO_LARGE");

/** O corpo de uma resposta, sem ler mais do que `maxBytes`: o resto nem chega a vir. */
async function readBody(res: Response, maxBytes?: number): Promise<string> {
  if (maxBytes === undefined || !res.body) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
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

  private async post(
    path: string,
    body: unknown,
    limits: { timeoutMs: number; maxBytes?: number },
  ): Promise<unknown> {
    if (!this.config)
      throw new AppError(
        "O WhatsApp não está configurado (EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE).",
        503,
        "WHATSAPP_NOT_CONFIGURED",
      );
    const { baseUrl, apiKey, instance } = this.config;
    try {
      const res = await this.fetchFn(`${baseUrl}/${path}/${encodeURIComponent(instance)}`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(limits.timeoutMs),
      });
      const text = await readBody(res, limits.maxBytes);
      if (!res.ok)
        throw new AppError(
          `A Evolution API recusou o pedido (${res.status}).`,
          502,
          "WHATSAPP_API_ERROR",
        );
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
        throw new AppError("A Evolution API não respondeu a tempo.", 504, "WHATSAPP_API_TIMEOUT");
      throw error;
    }
  }

  async sendText(phone: string, text: string) {
    await this.post("message/sendText", { number: phone, text }, { timeoutMs: SEND_TIMEOUT_MS });
  }

  async downloadMedia(rawMessage: unknown, options: { maxBytes?: number } = {}) {
    const { maxBytes } = options;
    const data = (await this.post(
      "chat/getBase64FromMediaMessage",
      { message: rawMessage, convertToMp4: false },
      {
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        // O ficheiro vem em base64 (um terço maior) dentro de um JSON pequeno.
        ...(maxBytes !== undefined ? { maxBytes: Math.ceil((maxBytes * 4) / 3) + 4096 } : {}),
      },
    )) as { base64?: string; mimetype?: string } | null;
    if (!data?.base64)
      throw new AppError("Não foi possível ir buscar o ficheiro.", 502, "WHATSAPP_API_ERROR");
    const bytes = new Uint8Array(Buffer.from(data.base64, "base64"));
    if (maxBytes !== undefined && bytes.length > maxBytes) throw tooLarge();
    return { data: bytes, mimeType: data.mimetype ?? "application/octet-stream" };
  }
}
