import { GoogleRestWorkspace } from "@/server/integrations/google/google-rest.workspace";

type Call = {
  url: URL;
  method: string;
  body: unknown;
  auth: string | null;
  contentType: string | null;
};

/** O corpo de um pedido: o JSON, ou o texto tal como foi quando não é JSON. */
const bodyOf = (body: unknown): unknown => {
  if (!body) return undefined;
  try {
    return JSON.parse(String(body));
  } catch {
    return String(body);
  }
};

/** Um `fetch` que responde pela ordem e guarda o que lhe pediram. */
function fakeFetch(
  ...responses: Array<{ status?: number; json?: unknown; bytes?: Uint8Array | string }>
) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      body: bodyOf(init?.body),
      auth: new Headers(init?.headers).get("authorization"),
      contentType: new Headers(init?.headers).get("content-type"),
    });
    const next = responses.shift() ?? { json: {} };
    if (next.bytes !== undefined)
      return new Response(next.bytes as BodyInit, { status: next.status ?? 200 });
    return new Response(next.status === 204 ? null : JSON.stringify(next.json ?? {}), {
      status: next.status ?? 200,
    });
  }) as typeof fetch;
  return { fn, calls };
}

const workspace = (f: ReturnType<typeof fakeFetch>) =>
  new GoogleRestWorkspace(async () => "token-1", f.fn);

describe("GoogleRestWorkspace: agenda", () => {
  it("lista os compromissos de um intervalo, sem os cancelados", async () => {
    const f = fakeFetch({
      json: {
        items: [
          {
            id: "e1",
            summary: "Reunião com o João",
            start: { dateTime: "2026-11-12T15:00:00Z" },
            end: { dateTime: "2026-11-12T16:00:00Z" },
            attendees: [{ email: "joao@cliente.pt" }],
            hangoutLink: "https://meet.google.com/abc",
            htmlLink: "https://calendar.google.com/e1",
          },
          { id: "e2", status: "cancelled" },
          { id: "e3", start: { date: "2026-11-13" }, end: { date: "2026-11-14" } },
        ],
      },
    });
    const events = await workspace(f).listEvents({
      from: new Date("2026-11-12T00:00:00Z"),
      to: new Date("2026-11-14T00:00:00Z"),
    });

    expect(events).toEqual([
      {
        id: "e1",
        title: "Reunião com o João",
        start: "2026-11-12T15:00:00Z",
        end: "2026-11-12T16:00:00Z",
        allDay: false,
        attendees: ["joao@cliente.pt"],
        meetLink: "https://meet.google.com/abc",
        link: "https://calendar.google.com/e1",
        location: null,
      },
      expect.objectContaining({
        id: "e3",
        title: "(sem título)",
        allDay: true,
        start: "2026-11-13",
      }),
    ]);
    const { url, auth } = f.calls[0];
    expect(auth).toBe("Bearer token-1");
    expect(url.pathname).toBe("/calendar/v3/calendars/primary/events");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      timeMin: "2026-11-12T00:00:00.000Z",
      timeMax: "2026-11-14T00:00:00.000Z",
      singleEvents: "true",
      orderBy: "startTime",
    });
  });

  it("cria um compromisso com Meet, na hora de parede do fuso, e avisa os convidados", async () => {
    const f = fakeFetch({ json: { id: "e9", summary: "Reunião" } });
    await workspace(f).createEvent({
      title: "Reunião",
      start: "2026-11-12T15:00",
      end: "2026-11-12T15:30",
      timeZone: "Europe/Lisbon",
      attendees: ["joao@cliente.pt"],
      withMeet: true,
    });

    const { url, method, body } = f.calls[0];
    expect(method).toBe("POST");
    expect(url.searchParams.get("sendUpdates")).toBe("all");
    expect(url.searchParams.get("conferenceDataVersion")).toBe("1");
    expect(body).toMatchObject({
      summary: "Reunião",
      start: { dateTime: "2026-11-12T15:00:00", timeZone: "Europe/Lisbon" },
      end: { dateTime: "2026-11-12T15:30:00", timeZone: "Europe/Lisbon" },
      attendees: [{ email: "joao@cliente.pt" }],
      conferenceData: { createRequest: { conferenceSolutionKey: { type: "hangoutsMeet" } } },
    });
  });

  it("altera só o que mudou e apaga pelo id", async () => {
    const f = fakeFetch({ json: { id: "e 1" } }, { status: 204 });
    const ws = workspace(f);
    await ws.updateEvent("e 1", { start: "2026-11-13T10:00", timeZone: "Europe/Lisbon" });
    await ws.deleteEvent("e 1");

    expect(f.calls[0].method).toBe("PATCH");
    expect(f.calls[0].url.pathname).toMatch(/\/events\/e%201$/);
    expect(f.calls[0].body).toEqual({
      start: { dateTime: "2026-11-13T10:00:00", timeZone: "Europe/Lisbon" },
    });
    expect(f.calls[1].method).toBe("DELETE");
    expect(f.calls[1].url.searchParams.get("sendUpdates")).toBe("all");
  });
});

describe("GoogleRestWorkspace: Gmail", () => {
  const message = (id: string) => ({
    id,
    snippet: "Segue a fatura…",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: "João <joao@cliente.pt>" },
        { name: "To", value: "isabel@escritorio.pt" },
        { name: "Subject", value: "Fatura de outubro" },
        { name: "Date", value: "Thu, 12 Nov 2026 10:00:00 +0000" },
      ],
      body: { data: Buffer.from("Olá Isabel, segue a fatura.").toString("base64url") },
    },
  });

  it("procura e devolve o resumo de cada mensagem", async () => {
    const f = fakeFetch({ json: { messages: [{ id: "m1" }] } }, { json: message("m1") });
    const emails = await workspace(f).searchEmails("from:joao fatura", 5);

    expect(emails).toEqual([
      {
        id: "m1",
        from: "João <joao@cliente.pt>",
        to: "isabel@escritorio.pt",
        subject: "Fatura de outubro",
        date: "Thu, 12 Nov 2026 10:00:00 +0000",
        snippet: "Segue a fatura…",
        unread: false,
      },
    ]);
    expect(f.calls[0].url.searchParams.get("q")).toBe("from:joao fatura");
    expect(f.calls[0].url.searchParams.get("maxResults")).toBe("5");
    expect(f.calls[1].url.searchParams.get("format")).toBe("metadata");
  });

  it("lê uma mensagem inteira", async () => {
    const f = fakeFetch({ json: message("m1") });
    await expect(workspace(f).getEmail("m1")).resolves.toMatchObject({
      subject: "Fatura de outubro",
      body: "Olá Isabel, segue a fatura.",
    });
  });

  it("diz quais dos emails ainda estão por ler", async () => {
    const f = fakeFetch(
      { json: { messages: [{ id: "m1" }, { id: "m2" }] } },
      { json: { ...message("m1"), labelIds: ["INBOX", "UNREAD"] } },
      { json: { ...message("m2"), labelIds: ["INBOX"] } },
    );
    const emails = await workspace(f).searchEmails("is:unread in:inbox", 5);

    expect(emails.map((e) => e.unread)).toEqual([true, false]);
  });

  const withAttachment = {
    ...message("m1"),
    threadId: "th1",
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        ...message("m1").payload.headers,
        { name: "Cc", value: "ana@cliente.pt" },
        { name: "Message-ID", value: "<abc@mail.cliente.pt>" },
        { name: "References", value: "<111@x>" },
      ],
      parts: [
        {
          partId: "0",
          mimeType: "text/plain",
          body: { data: Buffer.from("Segue em anexo.").toString("base64url") },
        },
        {
          partId: "1",
          mimeType: "application/pdf",
          filename: "fatura.pdf",
          body: { attachmentId: "att-1", size: 4 },
        },
      ],
    },
  };

  it("ao ler uma mensagem, diz que anexos traz", async () => {
    const f = fakeFetch({ json: withAttachment });

    await expect(workspace(f).getEmail("m1")).resolves.toMatchObject({
      body: "Segue em anexo.",
      attachments: [{ partId: "1", fileName: "fatura.pdf", mimeType: "application/pdf", size: 4 }],
    });
  });

  it("vai buscar um anexo pela parte da mensagem", async () => {
    const f = fakeFetch(
      { json: withAttachment },
      { json: { size: 4, data: Buffer.from("%PDF").toString("base64url") } },
    );
    const file = await workspace(f).getAttachment("m1", "1");

    expect(file.name).toBe("fatura.pdf");
    expect(file.mimeType).toBe("application/pdf");
    expect(new TextDecoder().decode(file.data)).toBe("%PDF");
    expect(f.calls[1].url.pathname).toBe("/gmail/v1/users/me/messages/m1/attachments/att-1");
  });

  it("diz quando a mensagem não tem o anexo pedido", async () => {
    const f = fakeFetch({ json: withAttachment });
    await expect(workspace(f).getAttachment("m1", "7")).rejects.toMatchObject({ status: 404 });
  });

  it("recusa um anexo grande demais sem o descarregar", async () => {
    const big = structuredClone(withAttachment);
    big.payload.parts[1].body.size = 30_000_000;
    const f = fakeFetch({ json: big });

    await expect(workspace(f).getAttachment("m1", "1")).rejects.toMatchObject({ status: 413 });
    expect(f.calls).toHaveLength(1);
  });

  it("prepara a resposta a um email: a quem, o assunto e a conversa", async () => {
    const f = fakeFetch(
      { json: { emailAddress: "isabel@escritorio.pt" } },
      { json: withAttachment },
    );

    await expect(workspace(f).replyTarget("m1", true)).resolves.toEqual({
      threadId: "th1",
      to: ["joao@cliente.pt"],
      cc: ["ana@cliente.pt"],
      subject: "Re: Fatura de outubro",
      inReplyTo: "<abc@mail.cliente.pt>",
      references: "<111@x> <abc@mail.cliente.pt>",
    });
    expect(f.calls[0].url.pathname).toBe("/gmail/v1/users/me/profile");
    expect(f.calls[1].url.searchParams.get("format")).toBe("metadata");
  });

  it("envia a resposta dentro da conversa", async () => {
    const f = fakeFetch({ json: { id: "s2" } });
    await workspace(f).sendEmail({
      to: ["joao@cliente.pt"],
      subject: "Re: Fatura de outubro",
      body: "Recebido.",
      threadId: "th1",
      inReplyTo: "<abc@mail.cliente.pt>",
      references: "<111@x> <abc@mail.cliente.pt>",
    });

    const body = f.calls[0].body as { raw: string; threadId?: string };
    expect(body.threadId).toBe("th1");
    expect(Buffer.from(body.raw, "base64url").toString()).toContain(
      "In-Reply-To: <abc@mail.cliente.pt>",
    );
  });

  it("com anexos, envia a mensagem pelo endereço de upload, com a conversa a que pertence", async () => {
    const f = fakeFetch({ json: { id: "s3" } });
    const result = await workspace(f).sendEmail({
      to: ["joao@cliente.pt"],
      subject: "Re: Contrato",
      body: "Segue.",
      threadId: "th1",
      attachments: [
        { name: "Contrato.pdf", mimeType: "application/pdf", data: new Uint8Array([1, 2, 3]) },
      ],
    });

    expect(result).toEqual({ id: "s3" });
    const call = f.calls[0];
    expect(call.method).toBe("POST");
    expect(call.url.pathname).toBe("/upload/gmail/v1/users/me/messages/send");
    expect(call.url.searchParams.get("uploadType")).toBe("multipart");
    const boundary = /^multipart\/related; boundary="([^"]+)"$/.exec(call.contentType!)![1];
    const [, metadata, message] = String(call.body).split(`--${boundary}`);
    expect(metadata).toContain("Content-Type: application/json; charset=UTF-8");
    expect(JSON.parse(metadata.split("\r\n\r\n")[1])).toEqual({ threadId: "th1" });
    expect(message).toContain("Content-Type: message/rfc822\r\n\r\nTo: joao@cliente.pt");
    expect(message).toContain('Content-Type: application/pdf; name="Contrato.pdf"');
    expect(String(call.body).trimEnd().endsWith(`--${boundary}--`)).toBe(true);
  });

  it("um email novo não vai preso a conversa nenhuma", async () => {
    const f = fakeFetch({ json: { id: "s1" } });
    await workspace(f).sendEmail({ to: ["a@b.pt"], subject: "Olá", body: "Bom dia" });
    expect(f.calls[0].body).not.toHaveProperty("threadId");
  });

  it("envia a mensagem em base64url", async () => {
    const f = fakeFetch({ json: { id: "s1" } });
    const result = await workspace(f).sendEmail({
      to: ["a@b.pt"],
      subject: "Olá",
      body: "Bom dia",
    });

    expect(result).toEqual({ id: "s1" });
    expect(f.calls[0].url.pathname).toBe("/gmail/v1/users/me/messages/send");
    const raw = Buffer.from((f.calls[0].body as { raw: string }).raw, "base64url").toString();
    expect(raw).toContain("To: a@b.pt");
    expect(raw).toContain(
      "Subject: Olá".replace("Olá", `=?UTF-8?B?${Buffer.from("Olá").toString("base64")}?=`),
    );
  });
});

describe("GoogleRestWorkspace: contactos, Drive e Docs", () => {
  it("junta os contactos guardados aos outros, sem repetir", async () => {
    const joao = {
      person: {
        names: [{ displayName: "João Silva" }],
        emailAddresses: [{ value: "joao@cliente.pt" }],
        phoneNumbers: [{ value: "+351 910 000 000" }],
      },
    };
    const f = fakeFetch(
      { json: { results: [joao] } },
      { json: { results: [joao, { person: { emailAddresses: [{ value: "joana@x.pt" }] } }] } },
    );
    const contacts = await workspace(f).searchContacts("jo", 10);

    expect(contacts).toEqual([
      { name: "João Silva", emails: ["joao@cliente.pt"], phones: ["+351 910 000 000"] },
      { name: "", emails: ["joana@x.pt"], phones: [] },
    ]);
    expect(f.calls.map((c) => c.url.pathname)).toEqual([
      "/v1/people:searchContacts",
      "/v1/otherContacts:search",
    ]);
  });

  it("procura ficheiros sem deixar a pergunta partir a query", async () => {
    const f = fakeFetch({
      json: { files: [{ id: "f1", name: "Ata", mimeType: "application/pdf", webViewLink: "l" }] },
    });
    const files = await workspace(f).searchFiles("contrato d'Ávila", 5);

    expect(files).toEqual([
      { id: "f1", name: "Ata", mimeType: "application/pdf", link: "l", modifiedAt: null },
    ]);
    expect(f.calls[0].url.searchParams.get("q")).toBe(
      "(name contains 'contrato d\\'Ávila' or fullText contains 'contrato d\\'Ávila') and trashed = false",
    );
  });

  it("cria um documento e escreve-lhe o texto", async () => {
    const f = fakeFetch({ json: { documentId: "d1" } }, { json: {} });
    const doc = await workspace(f).createDocument("Ata", "Presentes: Isabel.");

    expect(doc).toEqual({ id: "d1", link: "https://docs.google.com/document/d/d1/edit" });
    expect(f.calls[0].body).toEqual({ title: "Ata" });
    expect(f.calls[1].url.pathname).toBe("/v1/documents/d1:batchUpdate");
    expect(f.calls[1].body).toEqual({
      requests: [{ insertText: { location: { index: 1 }, text: "Presentes: Isabel." } }],
    });
  });

  it("lê um Google Doc exportando-o como texto", async () => {
    const f = fakeFetch(
      { json: { id: "d1", name: "Ata", mimeType: "application/vnd.google-apps.document" } },
      { bytes: "Presentes: a equipa." },
    );
    const content = await workspace(f).readFile("d1");

    expect(content.name).toBe("Ata");
    expect(content.mimeType).toBe("text/plain");
    expect(new TextDecoder().decode(content.data)).toBe("Presentes: a equipa.");
    expect(f.calls[0].url.pathname).toBe("/drive/v3/files/d1");
    expect(f.calls[1].url.pathname).toBe("/drive/v3/files/d1/export");
    expect(f.calls[1].url.searchParams.get("mimeType")).toBe("text/plain");
    expect(f.calls[1].auth).toBe("Bearer token-1");
  });

  it("lê uma folha de cálculo do Google como CSV", async () => {
    const f = fakeFetch(
      { json: { id: "s1", name: "Despesas", mimeType: "application/vnd.google-apps.spreadsheet" } },
      { bytes: "Data,Valor\n12/11,40" },
    );
    const content = await workspace(f).readFile("s1");

    expect(content.mimeType).toBe("text/csv");
    expect(f.calls[1].url.searchParams.get("mimeType")).toBe("text/csv");
  });

  it("descarrega um PDF tal como está", async () => {
    const pdf = new Uint8Array([37, 80, 68, 70]);
    const f = fakeFetch(
      { json: { id: "p1", name: "Contrato.pdf", mimeType: "application/pdf", size: "4" } },
      { bytes: pdf },
    );
    const content = await workspace(f).readFile("p1");

    expect(content).toEqual({ name: "Contrato.pdf", mimeType: "application/pdf", data: pdf });
    expect(f.calls[1].url.pathname).toBe("/drive/v3/files/p1");
    expect(f.calls[1].url.searchParams.get("alt")).toBe("media");
  });

  it("recusa um ficheiro grande demais sem o descarregar", async () => {
    const f = fakeFetch({
      json: { id: "g1", name: "Vídeo.pdf", mimeType: "application/pdf", size: "30000000" },
    });

    await expect(workspace(f).readFile("g1")).rejects.toMatchObject({
      status: 413,
      code: "GOOGLE_FILE_TOO_LARGE",
    });
    expect(f.calls).toHaveLength(1);
  });

  it("diz que uma pasta ou um formulário não são ficheiros que se leiam", async () => {
    const f = fakeFetch({
      json: { id: "x1", name: "Clientes", mimeType: "application/vnd.google-apps.folder" },
    });

    await expect(workspace(f).readFile("x1")).rejects.toMatchObject({ status: 415 });
    expect(f.calls).toHaveLength(1);
  });

  it("para anexar, um ficheiro do Google segue em PDF e os outros como estão", async () => {
    const doc = fakeFetch(
      { json: { id: "d1", name: "Ata", mimeType: "application/vnd.google-apps.document" } },
      { bytes: "%PDF" },
    );
    const exported = await workspace(doc).attachableFile("d1");
    expect(exported).toMatchObject({ name: "Ata.pdf", mimeType: "application/pdf" });
    expect(doc.calls[1].url.pathname).toBe("/drive/v3/files/d1/export");
    expect(doc.calls[1].url.searchParams.get("mimeType")).toBe("application/pdf");

    const image = fakeFetch(
      { json: { id: "i1", name: "foto.png", mimeType: "image/png", size: "3" } },
      { bytes: new Uint8Array([1, 2, 3]) },
    );
    await expect(workspace(image).attachableFile("i1")).resolves.toEqual({
      name: "foto.png",
      mimeType: "image/png",
      data: new Uint8Array([1, 2, 3]),
    });
    expect(image.calls[1].url.searchParams.get("alt")).toBe("media");
  });

  it("diz o nome e o tamanho com que um ficheiro seguiria em anexo, sem o descarregar", async () => {
    const f = fakeFetch(
      { json: { id: "p1", name: "Contrato.pdf", mimeType: "application/pdf", size: "2048" } },
      { json: { id: "s1", name: "Despesas", mimeType: "application/vnd.google-apps.spreadsheet" } },
    );
    await expect(workspace(f).attachableInfo("p1")).resolves.toEqual({
      name: "Contrato.pdf",
      size: 2048,
    });
    await expect(workspace(f).attachableInfo("s1")).resolves.toEqual({
      name: "Despesas.pdf",
      size: null,
    });
    expect(f.calls).toHaveLength(2);
  });

  it("não anexa uma pasta, nem um ficheiro grande demais", async () => {
    const folder = fakeFetch({
      json: { id: "x", name: "Clientes", mimeType: "application/vnd.google-apps.folder" },
    });
    await expect(workspace(folder).attachableFile("x")).rejects.toMatchObject({ status: 415 });
    await expect(
      workspace(
        fakeFetch({
          json: { id: "x", name: "Clientes", mimeType: "application/vnd.google-apps.folder" },
        }),
      ).attachableInfo("x"),
    ).rejects.toMatchObject({ status: 415 });

    const big = fakeFetch({
      json: { id: "v", name: "video.mp4", mimeType: "video/mp4", size: "50000000" },
    });
    await expect(workspace(big).attachableFile("v")).rejects.toMatchObject({ status: 413 });
    expect(big.calls).toHaveLength(1);
  });

  it("um erro do Google ao descarregar sai com o estado e a mensagem dele", async () => {
    const f = fakeFetch(
      { json: { id: "p1", name: "a.pdf", mimeType: "application/pdf" } },
      { status: 404, json: { error: { message: "File not found" } } },
    );

    await expect(workspace(f).readFile("p1")).rejects.toThrow(/404.*File not found/);
  });

  it("um erro do Google sai com o estado e a mensagem dele", async () => {
    const f = fakeFetch({ status: 403, json: { error: { message: "Insufficient Permission" } } });
    await expect(workspace(f).searchFiles("x", 1)).rejects.toMatchObject({
      code: "GOOGLE_API_ERROR",
      googleStatus: 403,
      message: expect.stringContaining("Insufficient Permission"),
    });
  });
});

describe("GoogleRestWorkspace: Sheets", () => {
  const SHEETS = "/v4/spreadsheets";

  it("diz o título, o link e as folhas de uma folha de cálculo", async () => {
    const f = fakeFetch({
      json: {
        spreadsheetId: "s1",
        properties: { title: "Despesas" },
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/s1/edit",
        sheets: [{ properties: { title: "2026" } }, { properties: { title: "2025" } }],
      },
    });

    await expect(workspace(f).getSpreadsheet("s1")).resolves.toEqual({
      id: "s1",
      title: "Despesas",
      link: "https://docs.google.com/spreadsheets/d/s1/edit",
      sheets: ["2026", "2025"],
    });
    expect(f.calls[0].url.host).toBe("sheets.googleapis.com");
    expect(f.calls[0].url.pathname).toBe(`${SHEETS}/s1`);
  });

  it("lê as células de um intervalo, mesmo com espaços no nome da folha", async () => {
    const f = fakeFetch({
      json: {
        range: "'Folha 1'!A1:B2",
        values: [
          ["Data", "Valor"],
          ["12/11", 40],
        ],
      },
    });

    await expect(workspace(f).readCells("s1", "Folha 1!A1:B2")).resolves.toEqual({
      range: "'Folha 1'!A1:B2",
      values: [
        ["Data", "Valor"],
        ["12/11", 40],
      ],
    });
    expect(decodeURIComponent(f.calls[0].url.pathname)).toBe(`${SHEETS}/s1/values/Folha 1!A1:B2`);
    expect(f.calls[0].url.pathname).not.toContain(" ");
  });

  it("um intervalo sem nada devolve zero linhas", async () => {
    const f = fakeFetch({ json: { range: "A1:Z1000" } });
    await expect(workspace(f).readCells("s1", "A1:Z1000")).resolves.toEqual({
      range: "A1:Z1000",
      values: [],
    });
  });

  it("cria uma folha de cálculo e escreve-lhe as primeiras linhas", async () => {
    const f = fakeFetch(
      {
        json: {
          spreadsheetId: "s9",
          spreadsheetUrl: "https://docs.google.com/spreadsheets/d/s9/edit",
        },
      },
      { json: { updatedRange: "A1:B1", updatedRows: 1 } },
    );

    await expect(workspace(f).createSpreadsheet("Despesas", [["Data", "Valor"]])).resolves.toEqual({
      id: "s9",
      link: "https://docs.google.com/spreadsheets/d/s9/edit",
    });
    expect(f.calls[0]).toMatchObject({
      method: "POST",
      body: { properties: { title: "Despesas" } },
    });
    expect(f.calls[1].method).toBe("PUT");
    expect(f.calls[1].url.pathname).toBe(`${SHEETS}/s9/values/A1`);
    expect(f.calls[1].body).toEqual({ values: [["Data", "Valor"]] });
  });

  it("sem linhas, cria a folha vazia num só pedido", async () => {
    const f = fakeFetch({ json: { spreadsheetId: "s9", spreadsheetUrl: "u" } });
    await workspace(f).createSpreadsheet("Vazia");
    expect(f.calls).toHaveLength(1);
  });

  it("escreve num intervalo, deixando o Sheets interpretar datas e números", async () => {
    const f = fakeFetch({ json: { updatedRange: "'2026'!A2:B2", updatedRows: 1 } });

    await expect(
      workspace(f).writeCells("s1", "2026!A2:B2", [["12/11/2026", "40,50"]], "replace"),
    ).resolves.toEqual({ range: "'2026'!A2:B2", rows: 1 });
    expect(f.calls[0].method).toBe("PUT");
    expect(f.calls[0].url.searchParams.get("valueInputOption")).toBe("USER_ENTERED");
    expect(f.calls[0].body).toEqual({ values: [["12/11/2026", "40,50"]] });
  });

  it("acrescenta linhas ao fim, sem escrever por cima do que lá está", async () => {
    const f = fakeFetch({ json: { updates: { updatedRange: "'2026'!A7:B8", updatedRows: 2 } } });

    await expect(
      workspace(f).writeCells(
        "s1",
        "2026",
        [
          ["a", 1],
          ["b", 2],
        ],
        "append",
      ),
    ).resolves.toEqual({ range: "'2026'!A7:B8", rows: 2 });
    expect(f.calls[0].method).toBe("POST");
    expect(f.calls[0].url.pathname).toBe(`${SHEETS}/s1/values/2026:append`);
    expect(f.calls[0].url.searchParams.get("insertDataOption")).toBe("INSERT_ROWS");
    expect(f.calls[0].url.searchParams.get("valueInputOption")).toBe("USER_ENTERED");
  });
});

describe("GoogleRestWorkspace: permissões em falta", () => {
  const denied = {
    status: 403,
    json: {
      error: {
        code: 403,
        message: "Request had insufficient authentication scopes.",
        status: "PERMISSION_DENIED",
        details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }],
      },
    },
  };

  it("um 403 por falta de permissão diz onde a dar", async () => {
    const f = fakeFetch(denied);
    const ws = new GoogleRestWorkspace(
      async () => "token-1",
      f.fn,
      "https://app.escritorio.pt/integracoes",
    );

    await expect(ws.readCells("s1", "A1")).rejects.toMatchObject({
      status: 409,
      code: "GOOGLE_MISSING_SCOPE",
      message: expect.stringContaining("https://app.escritorio.pt/integracoes"),
    });
  });

  it("um id errado ou um pedido mal feito é um erro de quem pediu; o resto é uma avaria", async () => {
    const status = async (google: number) =>
      workspace(fakeFetch({ status: google, json: { error: { message: "x" } } }))
        .readCells("s1", "A1")
        .catch((error: { status: number }) => error.status);

    expect(await status(404)).toBe(404);
    expect(await status(410)).toBe(404);
    expect(await status(400)).toBe(422);
    expect(await status(403)).toBe(502);
    expect(await status(429)).toBe(502);
    expect(await status(500)).toBe(502);
  });

  it("sem endereço configurado, diz na mesma o que falta fazer", async () => {
    const f = fakeFetch(denied);
    await expect(workspace(f).readCells("s1", "A1")).rejects.toThrow(/Dar as permissões/);
  });

  it("outro 403 continua a ser um erro do Google", async () => {
    const f = fakeFetch({
      status: 403,
      json: {
        error: { message: "The caller does not have permission", status: "PERMISSION_DENIED" },
      },
    });
    await expect(workspace(f).readCells("s1", "A1")).rejects.toMatchObject({
      code: "GOOGLE_API_ERROR",
    });
  });
});

describe("GoogleRestWorkspace: ids e datas para o agente de faturas", () => {
  it("messageDates pede o formato metadata só com id e internalDate, e lê a data", async () => {
    const f = fakeFetch(
      { json: { id: "a", internalDate: "1793491200000" } },
      { json: { id: "b" } },
    );
    const dates = await workspace(f).messageDates(["a", "b"]);
    expect(f.calls[0].url.pathname).toBe("/gmail/v1/users/me/messages/a");
    expect(f.calls[0].url.searchParams.get("format")).toBe("metadata");
    expect(f.calls[0].url.searchParams.get("fields")).toBe("id,internalDate");
    expect(dates.get("a")).toBe(1793491200000);
    expect(dates.has("b")).toBe(false);
  });

  it("listMessageIds segue as páginas até ao limite", async () => {
    const f = fakeFetch(
      { json: { messages: [{ id: "1" }, { id: "2" }], nextPageToken: "p2" } },
      { json: { messages: [{ id: "3" }] } },
    );
    await expect(workspace(f).listMessageIds("from:(a@x.pt)", 10)).resolves.toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(f.calls[1].url.searchParams.get("pageToken")).toBe("p2");
  });
});
