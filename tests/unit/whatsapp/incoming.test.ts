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

  it("lê uma imagem, com a legenda como pedido", () => {
    const image = parseEvolutionWebhook(
      webhook({
        imageMessage: {
          mimetype: "image/jpeg",
          caption: "  quanto é o total? ",
          fileLength: "20480",
        },
        base64: "QUJD",
      }),
    );

    expect(image).toMatchObject({
      kind: "image",
      text: "quanto é o total?",
      media: { mimeType: "image/jpeg", size: 20480, base64: "QUJD" },
    });
  });

  it("sem legenda, não inventa texto; sem tipo, uma imagem é um JPEG", () => {
    const image = parseEvolutionWebhook(webhook({ imageMessage: {} }));

    expect(image).toMatchObject({ kind: "image", media: { mimeType: "image/jpeg" } });
    expect(image!.text).toBeUndefined();
    expect(image!.media!.base64).toBeUndefined();
  });

  it("lê um documento, simples ou embrulhado com a legenda", () => {
    const plain = parseEvolutionWebhook(
      webhook({
        documentMessage: { mimetype: "application/pdf", fileName: "fatura.pdf", fileLength: 1000 },
      }),
    );
    expect(plain).toMatchObject({
      kind: "document",
      media: { mimeType: "application/pdf", fileName: "fatura.pdf", size: 1000 },
    });

    const wrapped = parseEvolutionWebhook(
      webhook({
        documentWithCaptionMessage: {
          message: {
            documentMessage: {
              mimetype: "application/pdf",
              fileName: "contrato.pdf",
              caption: "vê isto",
            },
          },
        },
      }),
    );
    expect(wrapped).toMatchObject({
      kind: "document",
      text: "vê isto",
      media: { fileName: "contrato.pdf" },
    });
  });

  it("lê o tamanho venha ele como número, texto ou no formato longo", () => {
    const sizeOf = (fileLength: unknown) =>
      parseEvolutionWebhook(webhook({ imageMessage: { fileLength } }))!.media!.size;

    expect(sizeOf(5000)).toBe(5000);
    expect(sizeOf("5000")).toBe(5000);
    expect(sizeOf({ low: 5000, high: 0, unsigned: true })).toBe(5000);
    expect(sizeOf(undefined)).toBeUndefined();
  });

  it("desembrulha as mensagens temporárias e as de ver uma só vez", () => {
    for (const wrapper of ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2"])
      expect(
        parseEvolutionWebhook(
          webhook({ [wrapper]: { message: { imageMessage: { caption: "olha" } } } }),
        ),
      ).toMatchObject({ kind: "image", text: "olha" });
  });

  it("assinala as mensagens de ver uma só vez, venham embrulhadas ou marcadas", () => {
    for (const wrapper of ["viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension"])
      expect(
        parseEvolutionWebhook(webhook({ [wrapper]: { message: { imageMessage: {} } } })),
      ).toMatchObject({ kind: "image", viewOnce: true });
    expect(
      parseEvolutionWebhook(
        webhook({
          ephemeralMessage: { message: { viewOnceMessageV2: { message: { imageMessage: {} } } } },
        }),
      ),
    ).toMatchObject({ kind: "image", viewOnce: true });
    expect(
      parseEvolutionWebhook(
        webhook({ viewOnceMessageV2Extension: { message: { audioMessage: {} } } }),
      ),
    ).toMatchObject({ kind: "audio", viewOnce: true });
    expect(parseEvolutionWebhook(webhook({ imageMessage: { viewOnce: true } }))).toMatchObject({
      kind: "image",
      viewOnce: true,
    });
  });

  it("uma mensagem normal ou temporária não fica assinalada como de ver uma vez", () => {
    expect(parseEvolutionWebhook(webhook({ imageMessage: {} }))?.viewOnce).toBeUndefined();
    expect(
      parseEvolutionWebhook(webhook({ ephemeralMessage: { message: { imageMessage: {} } } }))
        ?.viewOnce,
    ).toBeUndefined();
  });

  it("lê o texto e o áudio de uma conversa com mensagens temporárias", () => {
    expect(
      parseEvolutionWebhook(
        webhook({
          ephemeralMessage: { message: { extendedTextMessage: { text: " Que reuniões tenho? " } } },
        }),
      ),
    ).toMatchObject({ kind: "text", text: "Que reuniões tenho?" });
    expect(
      parseEvolutionWebhook(webhook({ ephemeralMessage: { message: { conversation: "Olá" } } })),
    ).toMatchObject({ kind: "text", text: "Olá" });
    expect(
      parseEvolutionWebhook(
        webhook({
          ephemeralMessage: { message: { audioMessage: { mimetype: "audio/ogg" } } },
          base64: "QUJD",
        }),
      ),
    ).toMatchObject({ kind: "audio", audio: { base64: "QUJD", mimeType: "audio/ogg" } });
  });

  it("um vídeo ou um autocolante conta como «outro»", () => {
    expect(parseEvolutionWebhook(webhook({ videoMessage: {} }))).toMatchObject({ kind: "other" });
    expect(parseEvolutionWebhook(webhook({ stickerMessage: {} }))).toMatchObject({
      kind: "other",
    });
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
