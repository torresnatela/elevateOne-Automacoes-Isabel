import OpenAI, { toFile } from "openai";
import { AppError } from "@/server/lib/errors";

/** Passa um áudio a texto. O canal do WhatsApp depende desta interface. */
export interface Transcriber {
  transcribe(audio: { data: Uint8Array; mimeType: string }): Promise<string>;
}

export const TRANSCRIPTION_MODEL = "gpt-4o-transcribe";

/** A extensão que a API quer no nome do ficheiro, pelo tipo do áudio. */
export function audioExtension(mimeType: string): string {
  const type = mimeType.split(";")[0].trim().toLowerCase();
  const known: Record<string, string> = {
    "audio/ogg": "ogg",
    "audio/opus": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "m4a",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/webm": "webm",
  };
  return known[type] ?? "ogg";
}

export class OpenAITranscriber implements Transcriber {
  private client: OpenAI | undefined;

  constructor(private readonly env: Record<string, string | undefined> = process.env) {}

  async transcribe(audio: { data: Uint8Array; mimeType: string }): Promise<string> {
    if (!this.env.OPENAI_API_KEY)
      throw new AppError(
        "A transcrição de áudio não está configurada (falta a OPENAI_API_KEY).",
        503,
        "TRANSCRIPTION_NOT_CONFIGURED",
      );
    this.client ??= new OpenAI({ apiKey: this.env.OPENAI_API_KEY });
    const result = await this.client.audio.transcriptions.create({
      model: TRANSCRIPTION_MODEL,
      language: "pt",
      file: await toFile(audio.data, `audio.${audioExtension(audio.mimeType)}`, {
        type: audio.mimeType.split(";")[0],
      }),
    });
    return result.text.trim();
  }
}
