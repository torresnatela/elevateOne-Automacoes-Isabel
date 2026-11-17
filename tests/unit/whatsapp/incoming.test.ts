import { parseEvolutionWebhook } from "@/server/channels/whatsapp/incoming";
import { webhook } from "../../setup/fake-whatsapp";

describe("parseEvolutionWebhook", () => {
  it("lê uma mensagem de texto, simples ou com formatação", () => {
    expect(parseEvolutionWebhook(webhook({ conversation: "  Olá  " }))).toMatchObject({
      id: "MSG1",
      phone: "351912345678",
      kind: "text",
      text: "Olá",
    });
    expect(
      parseEvolutionWebhook(webhook({ extendedTextMessage: { text: "Marca às 15h" } })),
    ).toMatchObject({ kind: "text", text: "Marca às 15h" });
  });

  it("lê um áudio, com ou sem o base64 no webhook", () => {
    const withData = parseEvolutionWebhook(
      webhook({ audioMessage: { mimetype: "audio/ogg; codecs=opus" }, base64: "QUJD" }),
    );
    expect(withData).toMatchObject({
      kind: "audio",
      audio: { base64: "QUJD", mimeType: "audio/ogg; codecs=opus" },
    });

    const without = parseEvolutionWebhook(webhook({ audioMessage: {} }));
    expect(without).toMatchObject({ kind: "audio" });
    expect(without!.audio).toBeUndefined();
    expect(without!.raw).toMatchObject({ key: { id: "MSG1" } });
  });

  it("aceita o nome do evento em maiúsculas e os dados numa lista", () => {
    const upper = webhook({ conversation: "Olá" }, {}, "MESSAGES_UPSERT");
    expect(parseEvolutionWebhook(upper)).toMatchObject({ kind: "text" });
    expect(parseEvolutionWebhook({ ...upper, data: [upper.data] })).toMatchObject({ kind: "text" });
  });

  it("com um id privado (@lid), usa o número que vem à parte", () => {
    const incoming = parseEvolutionWebhook(
      webhook(
        { conversation: "Olá" },
        { remoteJid: "9876543210@lid", senderPn: "351912345678@s.whatsapp.net" },
      ),
    );
    expect(incoming?.phone).toBe("351912345678");
    expect(
      parseEvolutionWebhook(webhook({ conversation: "Olá" }, { remoteJid: "9876543210@lid" })),
    ).toBeNull();
  });

  it("uma imagem ou um documento conta como «outro»", () => {
    expect(parseEvolutionWebhook(webhook({ imageMessage: {} }))).toMatchObject({ kind: "other" });
  });

  it("ignora o que não é uma mensagem de uma pessoa para nós", () => {
    const ignored = [
      webhook({ conversation: "Olá" }, { fromMe: true }),
      webhook({ conversation: "Olá" }, { remoteJid: "12036304@g.us" }),
      webhook({ conversation: "Olá" }, { remoteJid: "status@broadcast" }),
      webhook({ conversation: "Olá" }, {}, "connection.update"),
      webhook({ conversation: "Olá" }, { id: undefined }),
      null,
      "texto",
      {},
    ];
    for (const payload of ignored) expect(parseEvolutionWebhook(payload)).toBeNull();
  });
});
