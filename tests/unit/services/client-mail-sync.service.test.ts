import type { EmailMessage } from "@/server/integrations/google/workspace";
import type { Client } from "@/server/models/client.model";
import { ClientMailSyncService, buildQueries } from "@/server/services/client-mail-sync.service";
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

async function setup() {
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
      now: () => NOW,
    },
    {
      maxEmailsPerRun: 3,
      lookbackDays: 90,
      sendersPerQuery: 25,
      maxAttachmentBytes: 10_000_000,
      minImageBytes: 20_000,
      maxAttachmentsPerEmail: 10,
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

  it("não corre duas vezes ao mesmo tempo", async () => {
    const { mail, service } = await setup();
    mail.locked = true;
    await expect(service.run()).resolves.toEqual({ skipped: true, accounts: [] });
  });
});

it("buildQueries junta os remetentes em grupos, com a data", () => {
  const clients = [
    { contactEmails: ["a@x.pt", "b@x.pt"], emailDomains: ["y.pt"] },
    { contactEmails: ["c@z.pt"], emailDomains: [] },
  ] as unknown as Client[];
  const q = buildQueries(clients, new Date("2026-11-01T00:00:00Z"), 2);
  expect(q).toEqual([
    "from:(a@x.pt OR b@x.pt) after:1793491200 -in:sent -in:chats",
    "from:(@y.pt OR c@z.pt) after:1793491200 -in:sent -in:chats",
  ]);
});
