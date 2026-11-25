import { EvolutionClient } from "@/server/integrations/evolution/evolution.client";

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

  it("vai buscar o ficheiro de uma mensagem (um áudio, uma imagem, um documento)", async () => {
    const f = fakeFetch(200, {
      base64: Buffer.from("som").toString("base64"),
      mimetype: "audio/ogg",
    });
    const raw = { key: { id: "MSG1" } };
    const audio = await new EvolutionClient(config, f.fn).downloadMedia(raw);

    expect(new TextDecoder().decode(audio.data)).toBe("som");
    expect(audio.mimeType).toBe("audio/ogg");
    expect(f.calls[0].url).toBe("http://evolution:8080/chat/getBase64FromMediaMessage/escritorio");
    expect(f.calls[0].body).toMatchObject({ message: raw });
  });

  it("diz quando a Evolution não devolve o ficheiro", async () => {
    const f = fakeFetch(200, {});
    await expect(new EvolutionClient(config, f.fn).downloadMedia({})).rejects.toMatchObject({
      status: 502,
      message: "Não foi possível ir buscar o ficheiro.",
    });
  });

  it("não lê um ficheiro maior do que o limite pedido", async () => {
    const big = fakeFetch(200, { base64: Buffer.alloc(3000).toString("base64") });
    await expect(
      new EvolutionClient(config, big.fn).downloadMedia({}, { maxBytes: 1000 }),
    ).rejects.toMatchObject({ status: 413, code: "WHATSAPP_MEDIA_TOO_LARGE" });

    const small = fakeFetch(200, { base64: Buffer.alloc(900).toString("base64") });
    const media = await new EvolutionClient(config, small.fn).downloadMedia({}, { maxBytes: 1000 });
    expect(media.data).toHaveLength(900);
  });

  it("pára de receber quando a resposta passa do limite, em vez de a ler até ao fim", async () => {
    let sent = 0;
    const endless = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            sent += 1024;
            controller.enqueue(new Uint8Array(1024).fill(65));
          },
        }),
        { status: 200 },
      )) as typeof fetch;

    await expect(
      new EvolutionClient(config, endless).downloadMedia({}, { maxBytes: 1000 }),
    ).rejects.toMatchObject({ status: 413, code: "WHATSAPP_MEDIA_TOO_LARGE" });
    expect(sent).toBeLessThan(20_000);
  });

  it("não fica à espera para sempre de uma Evolution que não responde", async () => {
    let signal: AbortSignal | null | undefined;
    const hangs = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal;
      throw new DOMException("The operation timed out.", "TimeoutError");
    }) as typeof fetch;

    await expect(new EvolutionClient(config, hangs).sendText("351", "Olá")).rejects.toMatchObject({
      status: 504,
      code: "WHATSAPP_API_TIMEOUT",
    });
    expect(signal).toBeInstanceOf(AbortSignal);
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
