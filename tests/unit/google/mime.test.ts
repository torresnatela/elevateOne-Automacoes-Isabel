import { buildMimeMessage, extractBody } from "@/server/integrations/google/mime";

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
