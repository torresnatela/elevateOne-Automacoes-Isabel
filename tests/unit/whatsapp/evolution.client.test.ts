import { EvolutionClient } from "@/server/integrations/evolution/evolution.client";
import { audioExtension } from "@/server/integrations/openai/openai-transcriber";

function fakeFetch(status: number, json: unknown) {
  const calls: Array<{ url: string; headers: Headers; body: unknown }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify(json), { status });
  }) as typeof fetch;
  return { fn, calls };
}

const config = { baseUrl: "http://evolution:8080", apiKey: "chave-1", instance: "escritorio" };

describe("EvolutionClient", () => {
  it("envia um texto para um número", async () => {
    const f = fakeFetch(201, {});
    await new EvolutionClient(config, f.fn).sendText("351912345678", "Olá");

    expect(f.calls[0].url).toBe("http://evolution:8080/message/sendText/escritorio");
    expect(f.calls[0].headers.get("apikey")).toBe("chave-1");
    expect(f.calls[0].body).toEqual({ number: "351912345678", text: "Olá" });
  });

  it("vai buscar o áudio de uma mensagem", async () => {
    const f = fakeFetch(200, {
      base64: Buffer.from("som").toString("base64"),
      mimetype: "audio/ogg",
    });
    const raw = { key: { id: "MSG1" } };
    const audio = await new EvolutionClient(config, f.fn).downloadAudio(raw);

    expect(new TextDecoder().decode(audio.data)).toBe("som");
    expect(audio.mimeType).toBe("audio/ogg");
    expect(f.calls[0].url).toBe("http://evolution:8080/chat/getBase64FromMediaMessage/escritorio");
    expect(f.calls[0].body).toMatchObject({ message: raw });
  });

  it("um erro da Evolution não mostra a chave", async () => {
    const f = fakeFetch(401, { error: "Unauthorized" });
    const error = await new EvolutionClient(config, f.fn).sendText("351", "x").catch((e) => e);
    expect(error).toMatchObject({ status: 502, code: "WHATSAPP_API_ERROR" });
    expect(error.message).not.toContain("chave-1");
  });

  it("sem configuração, diz o que falta", async () => {
    const client = EvolutionClient.fromEnv({} as NodeJS.ProcessEnv);
    await expect(client.sendText("351", "x")).rejects.toMatchObject({
      code: "WHATSAPP_NOT_CONFIGURED",
    });
  });
});

describe("audioExtension", () => {
  it("dá à API a extensão do tipo de áudio (as mensagens de voz são ogg/opus)", () => {
    expect(audioExtension("audio/ogg; codecs=opus")).toBe("ogg");
    expect(audioExtension("audio/mpeg")).toBe("mp3");
    expect(audioExtension("audio/mp4")).toBe("m4a");
    expect(audioExtension("desconhecido")).toBe("ogg");
  });
});
