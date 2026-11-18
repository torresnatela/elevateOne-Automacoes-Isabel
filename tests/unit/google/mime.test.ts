import {
  buildMimeMessage,
  extractBody,
  listAttachments,
  replyHeaders,
} from "@/server/integrations/google/mime";

const b64url = (text: string) => Buffer.from(text, "utf8").toString("base64url");

describe("buildMimeMessage", () => {
  it("monta a mensagem com o assunto e o texto em UTF-8", () => {
    const mime = buildMimeMessage({
      to: ["joao@cliente.pt", "ana@cliente.pt"],
      cc: ["isabel@escritorio.pt"],
      subject: "Reunião de terça",
      body: "Olá João,\nconfirmo a reunião.",
    });
    const [head, body] = mime.split("\r\n\r\n");

    expect(head).toContain("To: joao@cliente.pt, ana@cliente.pt");
    expect(head).toContain("Cc: isabel@escritorio.pt");
    expect(head).toContain(
      `Subject: =?UTF-8?B?${Buffer.from("Reunião de terça").toString("base64")}?=`,
    );
    expect(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe(
      "Olá João,\nconfirmo a reunião.",
    );
  });

  it("deixa um assunto sem acentos como está, e não põe Cc sem destinatários", () => {
    const mime = buildMimeMessage({ to: ["a@b.pt"], subject: "Invoice 12", body: "x" });
    expect(mime).toContain("Subject: Invoice 12\r\n");
    expect(mime).not.toContain("Cc:");
  });

  it("não deixa injetar cabeçalhos pelo assunto ou pelo destinatário", () => {
    const mime = buildMimeMessage({
      to: ["a@b.pt\r\nBcc: espia@mau.com"],
      subject: "Olá\r\nBcc: espia@mau.com",
      body: "x",
    });
    const head = mime.split("\r\n\r\n")[0];
    expect(head.split("\r\n").filter((line) => line.startsWith("Bcc:"))).toEqual([]);
  });
});

describe("email com anexos", () => {
  const pdf = new Uint8Array(Array.from({ length: 300 }, (_, i) => i % 256));
  const build = (name: string) =>
    buildMimeMessage({
      to: ["joao@cliente.pt"],
      subject: "Contrato",
      body: "Segue o contrato.",
      attachments: [{ name, mimeType: "application/pdf", data: pdf }],
    });
  const partsOf = (mime: string) => {
    const boundary = /boundary="([^"]+)"/.exec(mime)![1];
    return mime
      .split(`--${boundary}`)
      .slice(1, -1)
      .map((part) => {
        const [head, body] = part.trim().split("\r\n\r\n");
        return { head, body: Buffer.from(body.replace(/\r\n/g, ""), "base64") };
      });
  };

  it("leva o texto e cada ficheiro, em partes separadas", () => {
    const mime = build("Contrato.pdf");
    expect(mime.split("\r\n\r\n")[0]).toContain("Content-Type: multipart/mixed; boundary=");
    const [text, file] = partsOf(mime);

    expect(text.head).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(text.body.toString("utf8")).toBe("Segue o contrato.");
    expect(file.head).toContain('Content-Type: application/pdf; name="Contrato.pdf"');
    expect(file.head).toContain('Content-Disposition: attachment; filename="Contrato.pdf"');
    expect(new Uint8Array(file.body)).toEqual(pdf);
    expect(mime.trimEnd().endsWith("--")).toBe(true);
  });

  it("nenhuma linha passa do que o correio aceita", () => {
    for (const line of build("Contrato.pdf").split("\r\n"))
      expect(line.length).toBeLessThanOrEqual(78);
  });

  it("um nome com acentos, aspas ou quebras de linha não parte os cabeçalhos", () => {
    const [, file] = partsOf(build('Relatório "final"\r\nBcc: x@y.pt.pdf'));

    expect(file.head.split("\r\n").filter((line) => /^bcc:/i.test(line))).toEqual([]);
    expect(file.head).toContain("filename*=UTF-8''Relat%C3%B3rio");
    expect(new Uint8Array(file.body)).toEqual(pdf);
  });

  it("num nome sem acentos, as aspas e as quebras de linha também não passam", () => {
    const [, file] = partsOf(build('Relatorio "final"\r\nBcc: x@y.pt.pdf'));

    expect(file.head.split("\r\n").filter((line) => /^bcc:/i.test(line))).toEqual([]);
    expect(file.head).toContain(`filename="Relatorio 'final' Bcc: x@y.pt.pdf"`);
  });

  it("um nome comprido é encurtado sem perder a extensão", () => {
    const [, file] = partsOf(build(`${"a".repeat(130)}.pdf`));

    expect(file.head).toContain(`filename="${"a".repeat(116)}.pdf"`);
  });

  it("encurtar o nome nunca parte um emoji a meio", () => {
    const [, file] = partsOf(build(`${"a".repeat(115)}😀${"b".repeat(20)}.pdf`));

    expect(file.head).toContain(`filename*=UTF-8''${"a".repeat(115)}%F0%9F%98%80.pdf`);
  });

  it("sem anexos, continua a ser uma mensagem de texto simples", () => {
    const mime = buildMimeMessage({ to: ["a@b.pt"], subject: "Olá", body: "x", attachments: [] });
    expect(mime).not.toContain("multipart");
  });
});

describe("responder a um email", () => {
  const original = {
    from: "João Silva <joao@cliente.pt>",
    replyTo: "",
    to: "rui@escritorio.pt, Ana <ana@cliente.pt>",
    cc: '"Costa, Marta" <marta@cliente.pt>',
    subject: "Fatura de outubro",
    messageId: "<abc@mail.cliente.pt>",
    references: "<111@x> <222@x>",
  };

  it("responde a quem escreveu, na mesma conversa", () => {
    expect(replyHeaders(original, "rui@escritorio.pt", false)).toEqual({
      to: ["joao@cliente.pt"],
      cc: [],
      subject: "Re: Fatura de outubro",
      inReplyTo: "<abc@mail.cliente.pt>",
      references: "<111@x> <222@x> <abc@mail.cliente.pt>",
    });
  });

  it("não repete o Re: de uma conversa que já vai a meio", () => {
    expect(
      replyHeaders({ ...original, subject: "RE: Fatura" }, "rui@escritorio.pt", false),
    ).toMatchObject({ subject: "RE: Fatura" });
  });

  it("prefere o endereço de resposta que o remetente indicou", () => {
    expect(
      replyHeaders({ ...original, replyTo: "faturas@cliente.pt" }, "rui@escritorio.pt", false).to,
    ).toEqual(["faturas@cliente.pt"]);
  });

  it("a todos: junta os outros destinatários, sem o próprio endereço e sem repetir", () => {
    const reply = replyHeaders(
      { ...original, cc: `${original.cc}, JOAO@cliente.pt` },
      "Rui@Escritorio.pt",
      true,
    );
    expect(reply.to).toEqual(["joao@cliente.pt"]);
    expect(reply.cc).toEqual(["ana@cliente.pt", "marta@cliente.pt"]);
  });

  it("ao responder a um email que a própria pessoa enviou, a resposta vai para quem o recebeu", () => {
    const sent = {
      ...original,
      from: "Rui <rui@escritorio.pt>",
      to: "João <joao@cliente.pt>",
      cc: "ana@cliente.pt",
    };
    expect(replyHeaders(sent, "rui@escritorio.pt", false)).toMatchObject({
      to: ["joao@cliente.pt"],
      cc: [],
    });
    expect(replyHeaders(sent, "rui@escritorio.pt", true)).toMatchObject({
      to: ["joao@cliente.pt"],
      cc: ["ana@cliente.pt"],
    });
  });

  it("uma nota que a pessoa enviou a si própria responde-se a si própria", () => {
    const note = { ...original, from: "rui@escritorio.pt", to: "rui@escritorio.pt", cc: "" };
    expect(replyHeaders(note, "rui@escritorio.pt", false).to).toEqual(["rui@escritorio.pt"]);
  });

  it("um endereço escrito no nome a mostrar não é destinatário", () => {
    expect(
      replyHeaders(
        { ...original, from: '"joao@antigo.pt" <joao@cliente.pt>' },
        "rui@escritorio.pt",
        false,
      ).to,
    ).toEqual(["joao@cliente.pt"]);
    expect(
      replyHeaders(
        {
          ...original,
          to: 'rui@escritorio.pt, "ana@antigo.pt (pessoal)" <ana@cliente.pt>',
          cc: "marta@antigo.pt <marta@cliente.pt>",
        },
        "rui@escritorio.pt",
        true,
      ).cc,
    ).toEqual(["ana@cliente.pt", "marta@cliente.pt"]);
  });

  it("um apóstrofo no endereço não o corta a meio", () => {
    const reply = replyHeaders(
      {
        ...original,
        from: "Sean O'Brien <sean.o'brien@example.ie>",
        to: "rui@escritorio.pt",
        cc: "d'angelo@cliente.pt, 'marta@cliente.pt'",
      },
      "rui@escritorio.pt",
      true,
    );

    expect(reply.to).toEqual(["sean.o'brien@example.ie"]);
    expect(reply.cc).toEqual(["d'angelo@cliente.pt", "marta@cliente.pt"]);
  });

  it("sem endereço de quem escreveu, não inventa destinatário", () => {
    expect(
      replyHeaders({ ...original, from: "Remetente desconhecido" }, "rui@escritorio.pt", false).to,
    ).toEqual([]);
  });

  it("uma conversa longa não dá uma linha de referências maior do que o correio aceita", () => {
    const ids = Array.from({ length: 120 }, (_, i) => `<mensagem-${i}-${"x".repeat(40)}@mail.pt>`);
    const head = buildMimeMessage({
      to: ["a@b.pt"],
      subject: "Re: x",
      body: "x",
      inReplyTo: ids.at(-1),
      references: ids.join(" "),
    }).split("\r\n\r\n")[0];

    for (const line of head.split("\r\n")) expect(line.length).toBeLessThanOrEqual(998);
    const unfolded = head.replace(/\r\n[ \t]/g, " ");
    const references = unfolded.split("\r\n").find((line) => line.startsWith("References: "))!;
    expect(references).toContain(ids[0]);
    expect(references.endsWith(ids.at(-1)!)).toBe(true);
    // As continuações começam por espaço: não passam por cabeçalhos novos.
    expect(head.split("\r\n").filter((line) => /^[A-Za-z-]+:/.test(line))).toHaveLength(7);
  });

  it("no primeiro email de uma conversa, as referências são só esse email", () => {
    expect(
      replyHeaders({ ...original, references: "" }, "rui@escritorio.pt", false).references,
    ).toBe("<abc@mail.cliente.pt>");
  });

  it("a mensagem leva os cabeçalhos que a prendem à conversa", () => {
    const head = buildMimeMessage({
      to: ["joao@cliente.pt"],
      subject: "Re: Fatura",
      body: "Recebido.",
      inReplyTo: "<abc@mail.cliente.pt>",
      references: "<111@x> <abc@mail.cliente.pt>",
    }).split("\r\n\r\n")[0];

    expect(head).toContain("In-Reply-To: <abc@mail.cliente.pt>\r\n");
    expect(head).toContain("References: <111@x> <abc@mail.cliente.pt>\r\n");
  });

  it("um email novo não leva cabeçalhos de resposta", () => {
    const mime = buildMimeMessage({ to: ["a@b.pt"], subject: "Olá", body: "x" });
    expect(mime).not.toContain("In-Reply-To");
    expect(mime).not.toContain("References");
  });
});

describe("listAttachments", () => {
  it("lista os anexos de uma mensagem, mesmo aninhados, e não o texto dela", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        {
          partId: "0",
          mimeType: "multipart/alternative",
          parts: [{ partId: "0.0", mimeType: "text/plain", filename: "", body: { data: "eA" } }],
        },
        {
          partId: "1",
          mimeType: "application/pdf",
          filename: "fatura.pdf",
          body: { attachmentId: "att-1", size: 5120 },
        },
        {
          partId: "2",
          mimeType: "multipart/mixed",
          parts: [
            {
              partId: "2.1",
              mimeType: "text/plain",
              filename: "notas.txt",
              body: { data: "eA", size: 1 },
            },
          ],
        },
      ],
    };

    expect(listAttachments(payload)).toEqual([
      { partId: "1", fileName: "fatura.pdf", mimeType: "application/pdf", size: 5120 },
      { partId: "2.1", fileName: "notas.txt", mimeType: "text/plain", size: 1 },
    ]);
  });
});

describe("extractBody", () => {
  it("prefere a parte em texto simples, mesmo aninhada", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", body: { data: b64url("Olá, segue a fatura.\n") } },
            { mimeType: "text/html", body: { data: b64url("<p>Olá</p>") } },
          ],
        },
        { mimeType: "application/pdf", body: {} },
      ],
    };
    expect(extractBody(payload)).toBe("Olá, segue a fatura.");
  });

  it("sem texto simples, usa o HTML sem as etiquetas", () => {
    const html = "<style>p{color:red}</style><p>Olá &amp; bom dia</p><div>Segue em anexo.</div>";
    expect(extractBody({ mimeType: "text/html", body: { data: b64url(html) } })).toBe(
      "Olá & bom dia\nSegue em anexo.",
    );
  });

  it("devolve vazio quando não há texto", () => {
    expect(extractBody({ mimeType: "application/pdf", body: {} })).toBe("");
  });
});
