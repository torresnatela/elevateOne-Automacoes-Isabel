import { GoogleRestWorkspace } from "@/server/integrations/google/google-rest.workspace";

type Call = { url: URL; method: string; body: unknown; auth: string | null };

/** Um `fetch` que responde pela ordem e guarda o que lhe pediram. */
function fakeFetch(...responses: Array<{ status?: number; json?: unknown }>) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: new Headers(init?.headers).get("authorization"),
    });
    const next = responses.shift() ?? { json: {} };
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

  it("um erro do Google sai com o estado e a mensagem dele", async () => {
    const f = fakeFetch({ status: 403, json: { error: { message: "Insufficient Permission" } } });
    await expect(workspace(f).searchFiles("x", 1)).rejects.toMatchObject({
      code: "GOOGLE_API_ERROR",
      googleStatus: 403,
      message: expect.stringContaining("Insufficient Permission"),
    });
  });
});
