import Anthropic from "@anthropic-ai/sdk";
import {
  AnthropicFileStore,
  FILE_TTL_SECONDS,
  type AnthropicFilesApi,
} from "@/server/integrations/anthropic/anthropic-file-store";

const file = { data: new Uint8Array([1, 2, 3]), mimeType: "image/png", fileName: "foto.png" };

describe("AnthropicFileStore", () => {
  it("envia o ficheiro com prazo de validade e devolve o id", async () => {
    const upload = vi.fn<AnthropicFilesApi["upload"]>(async () => ({ id: "file_abc" }));
    const store = new AnthropicFileStore({ upload, delete: async () => undefined });

    await expect(store.upload(file)).resolves.toBe("file_abc");
    expect(upload).toHaveBeenCalledWith(file, FILE_TTL_SECONDS);
    expect(FILE_TTL_SECONDS).toBe(48 * 60 * 60);
  });

  it("apagar um ficheiro que já não existe não é um erro", async () => {
    const store = new AnthropicFileStore({
      upload: async () => ({ id: "x" }),
      delete: async () => {
        throw new Anthropic.NotFoundError(404, undefined, "File not found", new Headers());
      },
    });

    await expect(store.delete("file_abc")).resolves.toBeUndefined();
  });

  it("outra falha ao apagar chega a quem pediu", async () => {
    const store = new AnthropicFileStore({
      upload: async () => ({ id: "x" }),
      delete: async () => {
        throw new Error("sem rede");
      },
    });

    await expect(store.delete("file_abc")).rejects.toThrow("sem rede");
  });
});
