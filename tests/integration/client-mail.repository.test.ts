import { PrismaClientMailRepository } from "@/server/repositories/client-mail.repository";
import { PrismaClientRepository } from "@/server/repositories/client.repository";
import { clientSchema } from "@/server/validators/client.schemas";
import { prisma, resetDatabase } from "../setup/db";

const repo = new PrismaClientMailRepository(prisma);
const clients = new PrismaClientRepository(prisma);

async function fixtures() {
  const user = await prisma.user.create({
    data: { name: "Isabel", email: "isabel@x.pt", passwordHash: "h" },
  });
  const account = await prisma.googleAccount.create({
    data: { userId: user.id, email: "isabel@x.pt", refreshTokenEncrypted: "x", scopes: "" },
  });
  const client = await clients.create(clientSchema.parse({ name: "Alfa", nif: "123456789" }));
  return { user, account, client };
}

const newEmail = (clientId: string, googleAccountId: string, id = "m1") => ({
  clientId,
  googleAccountId,
  mailbox: "isabel@x.pt",
  gmailMessageId: id,
  gmailThreadId: "t1",
  rfcMessageId: `<${id}@alfa.pt>`,
  fromAddress: "faturas@alfa.pt",
  subject: "Faturas",
  receivedAt: new Date("2026-11-24T10:00:00Z"),
  summary: "Envia uma fatura.",
  category: "FATURAS",
  actionNeeded: false,
  attachmentCount: 1,
});

const newInvoice = {
  attachmentPartId: "1",
  fileName: "ft.pdf",
  mimeType: "application/pdf",
  docType: "FT" as const,
  direction: "COMPRA" as const,
  number: "FT 1",
  atcud: null,
  issueDate: "2026-11-20",
  issuerName: "Fornecedor",
  issuerNif: "500000000",
  buyerName: "Alfa",
  buyerNif: "123456789",
  netTotal: 100,
  vatTotal: 23,
  total: 123.45,
  currency: "EUR",
  vatBreakdown: [{ rate: 23, base: 100, vat: 23 }],
  confidence: 0.9,
  status: "EXTRAIDA" as const,
  reviewReasons: [],
  raw: {},
};

describe("PrismaClientMailRepository", () => {
  beforeEach(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it("guarda o email com as faturas e marca-o como visto", async () => {
    const { account, client, user } = await fixtures();
    await repo.saveEmail(newEmail(client.id, account.id), [newInvoice]);
    expect(await repo.hasRfcMessageId("<m1@alfa.pt>")).toBe(true);
    expect([...(await repo.seenIds(account.id, ["m1", "m2"]))]).toEqual(["m1"]);

    const [invoice] = await repo.listInvoices({ clientId: client.id });
    expect(invoice).toMatchObject({
      clientName: "Alfa",
      emailSubject: "Faturas",
      issueDate: "2026-11-20",
      total: 123.45,
      vatBreakdown: [{ rate: 23, base: 100, vat: 23 }],
    });
    await expect(repo.findInvoiceSource(invoice.id)).resolves.toMatchObject({
      ownerUserId: user.id,
      gmailMessageId: "m1",
      attachmentPartId: "1",
    });
    expect((await repo.listEmails(client.id))[0]).toMatchObject({ summary: "Envia uma fatura." });
  });

  it("filtra as faturas por estado e data, e atualiza-as", async () => {
    const { account, client, user } = await fixtures();
    await repo.saveEmail(newEmail(client.id, account.id), [newInvoice]);
    const [invoice] = await repo.listInvoices({});
    expect(await repo.listInvoices({ status: "A_REVER" })).toHaveLength(0);
    expect(await repo.listInvoices({ from: new Date("2026-11-21") })).toHaveLength(0);
    const updated = await repo.updateInvoice(invoice.id, {
      status: "CONFIRMADA",
      total: 124,
      issueDate: "2026-11-21",
      reviewedById: user.id,
    });
    expect(updated).toMatchObject({ status: "CONFIRMADA", total: 124, issueDate: "2026-11-21" });
    await expect(
      repo.updateInvoice("00000000-0000-0000-0000-000000000000", { status: "REJEITADA" }),
    ).resolves.toBeNull();
  });

  it("sem data de emissão, o filtro de datas usa a data em que o email chegou", async () => {
    const { account, client } = await fixtures();
    await repo.saveEmail(newEmail(client.id, account.id), [{ ...newInvoice, issueDate: null }]);
    const nov24 = new Date("2026-11-24T00:00:00Z");
    expect(await repo.listInvoices({ from: nov24, to: nov24 })).toHaveLength(1);
    expect(await repo.listInvoices({ from: new Date("2026-11-25T00:00:00Z") })).toHaveLength(0);
  });

  it("a escrita condicionada ao estado não apaga uma confirmação feita entretanto", async () => {
    const { account, client } = await fixtures();
    await repo.saveEmail(newEmail(client.id, account.id), [{ ...newInvoice, status: "A_REVER" }]);
    const [invoice] = await repo.listInvoices({});
    await repo.updateInvoice(invoice.id, { status: "CONFIRMADA" });
    const after = await repo.updateInvoice(invoice.id, { status: "EXTRAIDA" }, "A_REVER");
    expect(after?.status).toBe("CONFIRMADA");
  });

  it("refreshReviewStatus recalcula a partir da fatura como está agora", async () => {
    const { account, client } = await fixtures();
    await repo.saveEmail(newEmail(client.id, account.id), [
      { ...newInvoice, status: "A_REVER", reviewReasons: ["Base + IVA não dá o total."] },
    ]);
    const [invoice] = await repo.listInvoices({});
    // Outra pessoa tirou a data entretanto: o recálculo vê isso, não a cópia antiga.
    await repo.updateInvoice(invoice.id, { issueDate: null, total: 123 });
    const refreshed = await repo.refreshReviewStatus(invoice.id);
    expect(refreshed).toMatchObject({ status: "A_REVER", reviewReasons: ["Falta a data."] });
    await repo.updateInvoice(invoice.id, { issueDate: "2026-11-20" });
    await expect(repo.refreshReviewStatus(invoice.id)).resolves.toMatchObject({
      status: "EXTRAIDA",
      reviewReasons: [],
    });
    await repo.updateInvoice(invoice.id, { status: "CONFIRMADA", issueDate: null });
    await expect(repo.refreshReviewStatus(invoice.id)).resolves.toMatchObject({
      status: "CONFIRMADA",
    });
  });

  it("depois de a conta passar a outra caixa, a corrida antiga não grava nada nela", async () => {
    const { account, client } = await fixtures();
    await prisma.googleAccount.update({ where: { id: account.id }, data: { email: "nova@x.pt" } });
    await repo.setSyncState(
      {
        googleAccountId: account.id,
        syncedUntil: new Date(),
        lastRunAt: new Date(),
        lastError: null,
      },
      "isabel@x.pt",
    );
    expect(await repo.getSyncState(account.id)).toBeNull();
    await expect(repo.saveEmail(newEmail(client.id, account.id), [newInvoice])).resolves.toEqual({
      invoices: 0,
    });
    expect(await repo.hasRfcMessageId("<m1@alfa.pt>")).toBe(false);
  });

  it("o mesmo email (Message-ID) não se guarda duas vezes", async () => {
    const { account, client } = await fixtures();
    await repo.saveEmail(newEmail(client.id, account.id), []);
    await expect(
      repo.saveEmail(
        { ...newEmail(client.id, account.id, "m2"), rfcMessageId: "<m1@alfa.pt>" },
        [],
      ),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("o trinco só deixa uma corrida de cada vez, e solta-se", async () => {
    expect(await repo.tryLock("x", 60_000)).toBe(true);
    expect(await repo.tryLock("x", 60_000)).toBe(false);
    await repo.unlock("x");
    expect(await repo.tryLock("x", 60_000)).toBe(true);
    expect(await repo.tryLock("y", -1)).toBe(true);
    expect(await repo.tryLock("y", 60_000)).toBe(true); // o anterior já tinha expirado
  });

  it("guarda o estado da sincronização de cada caixa", async () => {
    const { account } = await fixtures();
    const state = {
      googleAccountId: account.id,
      syncedUntil: new Date("2026-11-25T10:00:00Z"),
      lastRunAt: new Date("2026-11-25T10:00:00Z"),
      lastError: null,
    };
    await repo.setSyncState(state);
    await repo.setSyncState({ ...state, lastError: "x" });
    await expect(repo.getSyncState(account.id)).resolves.toMatchObject({ lastError: "x" });
    expect(await repo.listSyncStates()).toHaveLength(1);
  });
});
