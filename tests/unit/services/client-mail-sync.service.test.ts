import type { EmailMessage } from "@/server/integrations/google/workspace";
import type { Client } from "@/server/models/client.model";
import {
  ClientMailSyncService,
  batchAttachments,
  buildQueries,
  discover,
  oldestFirst,
} from "@/server/services/client-mail-sync.service";
import { FakeClientRepository } from "../../setup/fake-client.repository";
import { FakeClientMailRepository, FakeInvoiceExtractor } from "../../setup/fake-client-mail";
import { FakeGoogleWorkspace } from "../../setup/fake-google";
import { clientSchema } from "@/server/validators/client.schemas";

const NOW = new Date("2026-11-25T12:00:00Z");

const email = (id: string, over: Partial<EmailMessage> = {}): EmailMessage => ({
  id,
  from: "Ana <faturas@alfa.pt>",
  to: "gabinete@x.pt",
  subject: `Assunto ${id}`,
  date: "Tue, 24 Nov 2026 10:00:00 +0000",
  snippet: "",
  unread: true,
  body: "Seguem as faturas.",
  attachments: [{ partId: "1", fileName: "ft.pdf", mimeType: "application/pdf", size: 50_000 }],
  rfcMessageId: `<${id}@alfa.pt>`,
  threadId: `t-${id}`,
  ...over,
});

async function setup(clock: () => Date = () => NOW) {
  const clients = new FakeClientRepository();
  const alfa = await clients.create(
    clientSchema.parse({ name: "Alfa", nif: "123456789", contactEmails: ["faturas@alfa.pt"] }),
  );
  const mail = new FakeClientMailRepository();
  const workspaces = new Map<string, FakeGoogleWorkspace>([
    ["u1", new FakeGoogleWorkspace()],
    ["u2", new FakeGoogleWorkspace()],
  ]);
  const accounts = [
    { id: "acc1", userId: "u1", email: "isabel@x.pt" },
    { id: "acc2", userId: "u2", email: "geral@x.pt" },
  ];
  const extractor = new FakeInvoiceExtractor((m) => ({
    summary: `Resumo de ${m.subject}`,
    category: "FATURAS",
    actionNeeded: false,
    invoices: m.attachments.map((a) => ({
      partId: a.partId,
      docType: "FT",
      number: "FT 1",
      atcud: null,
      issueDate: "2026-11-20",
      issuerName: "Fornecedor",
      issuerNif: "500000000",
      buyerName: "Alfa",
      buyerNif: "123456789",
      netTotal: 100,
      vatTotal: 23,
      total: m.subject.includes("errada") ? 999 : 123,
      currency: "EUR",
      vatBreakdown: [],
      confidence: 0.9,
    })),
  }));
  const service = new ClientMailSyncService(
    {
      accounts: { listAll: async () => accounts },
      google: {
        workspaceFor: async (userId) => {
          if (userId === "u2" && workspaces.get("u2")!.emails.length === 0)
            throw new Error("A ligação ao Google expirou.");
          return workspaces.get(userId!)!;
        },
      },
      clients,
      mail,
      extractor,
      now: clock,
    },
    {
      maxEmailsPerRun: 3,
      lookbackDays: 90,
      sendersPerQuery: 25,
      maxAttachmentBytes: 10_000_000,
      minImageBytes: 20_000,
      maxAttachmentsPerEmail: 10,
      maxRequestBytes: 3,
      maxDiscovered: 100,
      maxPerDay: 1000,
    },
  );
  const addEmail = (user: string, e: EmailMessage) => {
    const ws = workspaces.get(user)!;
    ws.emails.unshift(e); // o Gmail devolve do mais recente para trás
    for (const a of e.attachments)
      ws.attachmentContents.set(`${e.id}/${a.partId}`, {
        name: a.fileName,
        mimeType: a.mimeType,
        data: new Uint8Array([1, 2]),
      });
  };
  return { alfa, clients, mail, workspaces, extractor, service, addEmail };
}

describe("ClientMailSyncService", () => {
  it("guarda o email do cliente com o resumo e a fatura, e marca a caixa como lida", async () => {
    const { alfa, mail, service, addEmail } = await setup();
    addEmail("u1", email("m1"));
    const report = await service.run();
    expect(report.accounts[0]).toMatchObject({ mailbox: "isabel@x.pt", newEmails: 1, invoices: 1 });
    expect(mail.emails[0]).toMatchObject({
      clientId: alfa.id,
      fromAddress: "faturas@alfa.pt",
      summary: "Resumo de Assunto m1",
      gmailThreadId: "t-m1",
    });
    expect(mail.invoices[0]).toMatchObject({ status: "EXTRAIDA", direction: "COMPRA" });
    expect(mail.states.get("acc1")?.syncedUntil).toEqual(NOW);
  });

  it("uma fatura incoerente fica a rever, com o motivo", async () => {
    const { mail, service, addEmail } = await setup();
    addEmail("u1", email("m1", { subject: "Fatura errada" }));
    await service.run();
    expect(mail.invoices[0].status).toBe("A_REVER");
    expect(mail.invoices[0].reviewReasons.join()).toContain("Base + IVA");
  });

  it("não volta a ler o que já leu, nem o mesmo email recebido noutra caixa", async () => {
    const { mail, service, addEmail, extractor } = await setup();
    addEmail("u1", email("m1"));
    addEmail("u2", email("outro-id", { rfcMessageId: "<m1@alfa.pt>" }));
    await service.run();
    await service.run();
    expect(extractor.calls).toHaveLength(1);
    expect(mail.emails).toHaveLength(1);
  });

  it("lê os mais antigos primeiro, até ao limite, e não avança a marca enquanto houver por ler", async () => {
    const { mail, service, addEmail, extractor } = await setup();
    for (const id of ["m1", "m2", "m3", "m4"]) addEmail("u1", email(id));
    const first = await service.run();
    expect(extractor.calls.map((c) => c.subject)).toEqual([
      "Assunto m1",
      "Assunto m2",
      "Assunto m3",
    ]);
    expect(first.accounts[0].pending).toBe(1);
    expect(mail.states.get("acc1")?.syncedUntil).toBeNull();
    await service.run();
    expect(mail.emails).toHaveLength(4);
    expect(mail.states.get("acc1")?.syncedUntil).toEqual(NOW);
  });

  it("um email que falha não para os outros, e fica para a próxima", async () => {
    const { mail, service, addEmail, extractor } = await setup();
    addEmail("u1", email("m1", { subject: "falha" }));
    addEmail("u1", email("m2"));
    extractor.failOn.add("falha");
    const report = await service.run();
    expect(report.accounts[0]).toMatchObject({ newEmails: 1, error: "O modelo falhou." });
    expect(mail.states.get("acc1")?.syncedUntil).toBeNull();
    extractor.failOn.clear();
    await service.run();
    expect(mail.emails).toHaveLength(2);
  });

  it("uma caixa com erro não impede as outras", async () => {
    const { mail, service, addEmail } = await setup();
    addEmail("u1", email("m1"));
    const report = await service.run();
    expect(report.accounts[1]).toMatchObject({
      mailbox: "geral@x.pt",
      error: "A ligação ao Google expirou.",
    });
    expect(mail.emails).toHaveLength(1);
    expect(mail.states.get("acc2")?.lastError).toBe("A ligação ao Google expirou.");
  });

  it("ignora logótipos e ficheiros que o modelo não lê", async () => {
    const { service, addEmail, extractor } = await setup();
    addEmail(
      "u1",
      email("m1", {
        attachments: [
          { partId: "1", fileName: "logo.png", mimeType: "image/png", size: 3_000 },
          { partId: "2", fileName: "x.zip", mimeType: "application/zip", size: 50_000 },
          { partId: "3", fileName: "ft.jpg", mimeType: "image/jpeg", size: 80_000 },
        ],
      }),
    );
    await service.run();
    expect(extractor.calls[0].attachments.map((a) => a.partId)).toEqual(["3"]);
  });

  it("start fica com o trinco antes de responder e só o solta quando a corrida acaba", async () => {
    const { mail, service, addEmail } = await setup();
    addEmail("u1", email("m1"));
    let task: (() => Promise<void>) | null = null;
    await expect(service.start((t) => (task = t))).resolves.toBe(true);
    // Ainda não correu, mas já conta como a decorrer: quem espera não vê um falso fim.
    expect(await service.isRunning()).toBe(true);
    await task!();
    expect(await service.isRunning()).toBe(false);
    expect(mail.emails).toHaveLength(1);
  });

  it("start diz que não começou quando outra corrida já está a decorrer", async () => {
    const { mail, service } = await setup();
    mail.locked = true;
    const defer = vi.fn();
    await expect(service.start(defer)).resolves.toBe(false);
    expect(defer).not.toHaveBeenCalled();
  });

  it("uma corrida que falha antes de ler as caixas deixa o erro no estado de todas", async () => {
    const { mail, service, clients } = await setup();
    vi.spyOn(clients, "list").mockRejectedValue(new Error("base em baixo"));
    await expect(service.run()).rejects.toThrow("base em baixo");
    for (const id of ["acc1", "acc2"]) {
      expect(mail.states.get(id)).toMatchObject({
        lastError: "A corrida falhou: base em baixo",
        lastRunAt: null,
        syncedUntil: null,
      });
    }
    expect(mail.locked).toBe(false);
  });

  it("start solta o trinco mesmo quando a corrida falha", async () => {
    const { mail, service, workspaces } = await setup();
    let task: (() => Promise<void>) | null = null;
    await service.start((t) => (task = t));
    vi.spyOn(mail, "getSyncState").mockRejectedValue(new Error("base em baixo"));
    workspaces.clear();
    await task!();
    expect(mail.locked).toBe(false);
  });

  it("diz se há uma corrida a decorrer, de onde quer que tenha vindo", async () => {
    const { mail, service } = await setup();
    expect(await service.isRunning()).toBe(false);
    mail.locked = true;
    expect(await service.isRunning()).toBe(true);
  });

  it("não corre duas vezes ao mesmo tempo", async () => {
    const { mail, service } = await setup();
    mail.locked = true;
    await expect(service.run()).resolves.toEqual({ skipped: true, accounts: [] });
  });
});

it("buildQueries junta os remetentes em grupos", () => {
  const clients = [
    { contactEmails: ["a@x.pt", "b@x.pt"], emailDomains: ["y.pt"] },
    { contactEmails: ["c@z.pt"], emailDomains: [] },
  ] as unknown as Client[];
  expect(buildQueries(clients, 2)).toEqual([
    "from:(a@x.pt OR b@x.pt) -in:sent -in:chats",
    "from:(@y.pt OR c@z.pt) -in:sent -in:chats",
  ]);
});

it("discover divide a janela ao meio quando a procura enche, até encontrar tudo", async () => {
  const DAY = 24 * 60 * 60;
  const from = new Date("2026-11-01T00:00:00Z");
  const to = new Date("2026-11-05T00:00:00Z");
  // Três emails por dia; a procura só devolve 4 de cada vez.
  const all = Array.from({ length: 12 }, (_, i) => ({
    id: `m${i}`,
    at: from.getTime() / 1000 + Math.floor(i / 3) * DAY + 3600 * (i % 3),
  }));
  const queries: string[] = [];
  const list = async (q: string, limit: number) => {
    queries.push(q);
    const after = Number(/after:(\d+)/.exec(q)![1]);
    const before = Number(/before:(\d+)/.exec(q)![1]);
    return all
      .filter((e) => e.at > after && e.at < before)
      .reverse()
      .slice(0, limit)
      .map((e) => e.id);
  };
  const result = await discover(list, "from:(a@x.pt)", from, to, 4);
  expect(result.truncated).toBe(false);
  expect(new Set(result.ids)).toEqual(
    new Set(all.filter((e) => e.at > from.getTime() / 1000).map((e) => e.id)),
  );
  expect(queries[0]).toContain("from:(a@x.pt) after:");
});

it("discover percorre todo um dia com mais emails do que o máximo de uma procura", async () => {
  const day = Array.from({ length: 23 }, (_, i) => `d${i}`);
  const limits: number[] = [];
  const list = async (_q: string, limit: number) => {
    limits.push(limit);
    return day.slice(0, limit);
  };
  const from = new Date("2026-11-01T00:00:00Z");
  const result = await discover(list, "q", from, new Date("2026-11-01T20:00:00Z"), 5, 100);
  expect(result).toEqual({ ids: day, truncated: false });
  expect(limits).toEqual([5, 100]);
});

it("discover só diz que ficou a faltar quando um dia passa até do máximo por dia", async () => {
  const list = async (_q: string, limit: number) =>
    Array.from({ length: limit }, (_, i) => `x${i}`);
  const result = await discover(
    list,
    "q",
    new Date("2026-11-01T00:00:00Z"),
    new Date("2026-11-03T00:00:00Z"),
    5,
    20,
  );
  expect(result.truncated).toBe(true);
});

it("lê pela data de chegada do Gmail, mesmo quando os ids não seguem essa ordem", async () => {
  const { service, addEmail, extractor, workspaces } = await setup();
  for (const id of ["m1", "m2", "m3", "m4"]) addEmail("u1", email(id));
  const ws = workspaces.get("u1")!;
  // m4 chegou primeiro e m1 por último.
  ws.arrivals.set("m4", 1).set("m3", 2).set("m2", 3).set("m1", 4);
  await service.run();
  expect(extractor.calls.map((c) => c.subject)).toEqual(["Assunto m4", "Assunto m3", "Assunto m2"]);
});

it("oldestFirst ordena os ids do Gmail pelo valor, juntando procuras diferentes", () => {
  expect(oldestFirst(["18f2", "18a0", "1900", "18f1"])).toEqual(["18a0", "18f1", "18f2", "1900"]);
});

it("batchAttachments junta os anexos em grupos que cabem num pedido", () => {
  const f = (n: number) => ({ data: new Uint8Array(n) });
  expect(batchAttachments([f(5), f(4), f(3), f(9)], 9).map((g) => g.length)).toEqual([2, 1, 1]);
  expect(batchAttachments([], 9)).toEqual([[]]);
});

it("um email com anexos que não cabem num pedido é lido em vários, e as faturas juntam-se", async () => {
  const { service, addEmail, extractor, mail } = await setup();
  addEmail(
    "u1",
    email("m1", {
      attachments: [
        { partId: "1", fileName: "a.pdf", mimeType: "application/pdf", size: 50_000 },
        { partId: "2", fileName: "b.pdf", mimeType: "application/pdf", size: 50_000 },
      ],
    }),
  );
  await service.run();
  expect(extractor.calls.map((c) => c.attachments.map((a) => a.partId))).toEqual([["1"], ["2"]]);
  expect(mail.emails).toHaveLength(1);
  expect(mail.invoices.map((i) => i.attachmentPartId)).toEqual(["1", "2"]);
});

it("não dá a caixa por lida quando a procura devolve o máximo de ids", async () => {
  const { service, addEmail, mail, workspaces } = await setup();
  addEmail("u1", email("m1"));
  // Cada procura enche sempre, até a de um dia inteiro (o máximo por dia é 10× o de uma procura).
  const ids = Array.from({ length: 1000 }, (_, i) => (i === 0 ? "m1" : `x${i}`));
  workspaces.get("u1")!.listMessageIds = async (_q: string, limit: number) => ids.slice(0, limit);
  // Todos já vistos: nada fica pendente, só a procura cortada impede de dar a caixa por lida.
  await mail.markSeen("acc1", ids);
  workspaces.get("u1")!.getEmail = async (id: string) =>
    email(id, { from: "alguem@fora.pt", attachments: [] });
  const report = await service.run();
  expect(report.accounts[0].pending).toBe(0);
  expect(report.accounts[0].error).toContain("num só dia");
  expect(mail.states.get("acc1")?.syncedUntil).toBeNull();
});

it("na primeira leitura, o início da janela não anda com o tempo entre corridas", async () => {
  let now = NOW;
  const { service, workspaces, mail, addEmail, extractor } = await setup(() => now);
  addEmail("u1", email("m1"));
  extractor.failOn.add("Assunto m1"); // a primeira leitura não acaba
  const queries: string[] = [];
  const ws = workspaces.get("u1")!;
  const list = ws.listMessageIds.bind(ws);
  ws.listMessageIds = async (q: string, limit: number) => {
    queries.push(q);
    return list(q, limit);
  };
  await service.run();
  const start = mail.states.get("acc1")?.startFrom;
  expect(start).toEqual(new Date(NOW.getTime() - 90 * 24 * 60 * 60_000));
  expect(mail.states.get("acc1")?.syncedUntil).toBeNull();

  now = new Date(NOW.getTime() + 5 * 24 * 60 * 60_000); // cinco dias depois
  queries.length = 0;
  await service.run();
  const after = Math.floor(start!.getTime() / 1000);
  expect(queries.every((q) => q.includes(`after:${after}`))).toBe(true);
  expect(mail.states.get("acc1")?.startFrom).toEqual(start);
});

it("o aviso da procura cortada junta-se ao erro de um email", async () => {
  const { service, addEmail, extractor, workspaces } = await setup();
  addEmail("u1", email("m1", { subject: "falha" }));
  extractor.failOn.add("falha");
  const ws = workspaces.get("u1")!;
  const filler = Array.from({ length: 1000 }, (_, i) => `x${i}`);
  ws.listMessageIds = async (_q: string, limit: number) => ["m1", ...filler].slice(0, limit);
  ws.getEmail = async (id: string) =>
    id === "m1"
      ? email("m1", { subject: "falha" })
      : email(id, { from: "alguem@fora.pt", attachments: [] });
  const report = await service.run();
  expect(report.accounts[0].error).toContain("O modelo falhou.");
  expect(report.accounts[0].error).toContain("num só dia");
});

it("discover, sem teto por dia, percorre um dia inteiro mesmo com dezenas de milhares de emails", async () => {
  const day = Array.from({ length: 25_000 }, (_, i) => `d${i}`);
  const list = async (_q: string, limit: number) => day.slice(0, limit);
  const result = await discover(
    list,
    "q",
    new Date("2026-11-01T00:00:00Z"),
    new Date("2026-11-01T23:00:00Z"),
    2000,
  );
  expect(result.truncated).toBe(false);
  expect(result.ids).toHaveLength(25_000);
});
