import Anthropic, { toFile } from "@anthropic-ai/sdk";
import type { LlmFileStore } from "@/server/agents/core/types";

type UploadedFile = { data: Uint8Array; mimeType: string; fileName: string };

/** A parte do SDK de que este cliente precisa (os testes dão-lhe uma falsa). */
export interface AnthropicFilesApi {
  upload(file: UploadedFile, expiresInSeconds: number): Promise<{ id: string }>;
  delete(fileId: string): Promise<unknown>;
}

/**
 * Quanto tempo um ficheiro fica na API. Uma conversa do WhatsApp acaba ao fim de umas
 * horas sem mensagens, e os ficheiros dela são apagados quando começa a seguinte; este
 * prazo é a rede para os que ficarem para trás (quem não voltou a escrever).
 */
export const FILE_TTL_SECONDS = 48 * 60 * 60;

/** Os ficheiros que o Claude lê, guardados na Files API da Anthropic. */
export class AnthropicFileStore implements LlmFileStore {
  constructor(private readonly api: AnthropicFilesApi) {}

  /** Com as credenciais do ambiente (`ANTHROPIC_API_KEY`), lidas só no primeiro pedido. */
  static fromEnv(): AnthropicFileStore {
    let client: Anthropic | undefined;
    return new AnthropicFileStore({
      upload: async (file, expiresInSeconds) => {
        client ??= new Anthropic();
        return client.files.upload({
          file: await toFile(file.data, file.fileName, { type: file.mimeType }),
          expires_in_seconds: expiresInSeconds,
        });
      },
      delete: (fileId) => {
        client ??= new Anthropic();
        return client.files.delete(fileId);
      },
    });
  }

  async upload(file: UploadedFile): Promise<string> {
    const { id } = await this.api.upload(file, FILE_TTL_SECONDS);
    return id;
  }

  async delete(fileId: string): Promise<void> {
    try {
      await this.api.delete(fileId);
    } catch (error) {
      // Já expirou ou já foi apagado: era o que se queria.
      if (!(error instanceof Anthropic.NotFoundError)) throw error;
    }
  }
}
