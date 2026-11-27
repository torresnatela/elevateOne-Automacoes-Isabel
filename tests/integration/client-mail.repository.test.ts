import { PrismaClientMailRepository } from "@/server/repositories/client-mail.repository";
import { PrismaClientRepository } from "@/server/repositories/client.repository";
import { PrismaGoogleAccountRepository } from "@/server/repositories/google-account.repository";
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
        startFrom: null,
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

  it("uma troca de caixa a meio faz a escrita da corrida antiga esperar e desistir", async () => {
    const { account } = await fixtures();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    // Outra ligação trinca a conta e troca a caixa, como faz o save do repositório das contas.
    const swap = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "google_accounts" WHERE "id" = ${account.id}::uuid FOR UPDATE`;
      locked();
      await held;
      await tx.googleAccount.update({ where: { id: account.id }, data: { email: "nova@x.pt" } });
    });
    await isLocked;
    const write = repo.setSyncState(
      {
        googleAccountId: account.id,
        syncedUntil: new Date(),
        startFrom: null,
        lastRunAt: new Date(),
        lastError: null,
      },
      "isabel@x.pt",
    );
    // A escrita está à espera do trinco; ao soltar, vê a caixa nova e não grava.
    await new Promise((r) => setTimeout(r, 200));
    release();
    await Promise.all([swap, write]);
    expect(await repo.getSyncState(account.id)).toBeNull();
  });

  describe("trocar de caixa enquanto a corrida grava (os métodos reais, nas duas ordens)", () => {
    const accounts = new PrismaGoogleAccountRepository(prisma);
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

    /** Quantas ligações estão à espera de um trinco nesta base (as que fazem fila na conta). */
    const waiters = async () =>
      Number(
        (
          await prisma.$queryRaw<{ n: bigint }[]>`
            SELECT count(*) AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query ILIKE '%google_accounts%FOR UPDATE%'`
        )[0].n,
      );

    /** Espera até `n` ligações estarem na fila do trinco (sem tempos fixos). */
    async function queued(n: number) {
      for (let i = 0; i < 200 && (await waiters()) < n; i++) await pause(10);
      expect(await waiters()).toBe(n);
    }

    /**
     * Segura o trinco da conta noutra ligação, põe `first` na fila, confirma que entrou, põe
     * `second` atrás dele, confirma, e só então solta: o Postgres serve-os por essa ordem.
     */
    async function inOrder<A, B>(
      accountId: string,
      first: () => Promise<A>,
      second: () => Promise<B>,
    ): Promise<[A, B]> {
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const isLocked = new Promise<void>((r) => (locked = r));
      const holder = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "google_accounts" WHERE "id" = ${accountId}::uuid FOR UPDATE`;
        locked();
        await held;
      });
      await isLocked;
      const a = first();
      await queued(1);
      const b = second();
      await queued(2);
      release();
      const [, ra, rb] = await Promise.all([holder, a, b]);
      return [ra, rb];
    }

    const state = (googleAccountId: string) => ({
      googleAccountId,
      syncedUntil: new Date(),
      startFrom: null,
      lastRunAt: new Date(),
      lastError: null,
    });
    const switchMailbox = (userId: string) =>
      accounts.save({ userId, email: "nova@x.pt", refreshTokenEncrypted: "y", scopes: "" });

    it.each(["escrita primeiro", "troca primeiro"])(
      "a marca de leitura da caixa antiga nunca fica na nova (%s)",
      async (order) => {
        const { account, user } = await fixtures();
        const write = () => repo.setSyncState(state(account.id), "isabel@x.pt");
        const swap = () => switchMailbox(user.id);
        // A escrita só grava quando corre antes da troca: confirma a ordem que de facto correu.
        const wrote =
          order === "escrita primeiro"
            ? (await inOrder(account.id, write, swap))[0]
            : (await inOrder(account.id, swap, write))[1];
        expect(wrote).toBe(order === "escrita primeiro");
        expect(await repo.getSyncState(account.id)).toBeNull();
      },
    );

    it.each(["escrita primeiro", "troca primeiro"])(
      "um email da caixa antiga nunca fica ligado à conta nova (%s)",
      async (order) => {
        const { account, client, user } = await fixtures();
        const write = () => repo.saveEmail(newEmail(client.id, account.id), [newInvoice]);
        const swap = () => switchMailbox(user.id);
        const saved =
          order === "escrita primeiro"
            ? (await inOrder(account.id, write, swap))[0]
            : (await inOrder(account.id, swap, write))[1];
        // Guardou (e a troca depois limpou) só quando a escrita correu primeiro.
        expect(saved).toEqual({ invoices: order === "escrita primeiro" ? 1 : 0 });
        expect(await prisma.clientEmail.count({ where: { googleAccountId: account.id } })).toBe(0);
        expect(await prisma.mailSeenMessage.count({ where: { googleAccountId: account.id } })).toBe(
          0,
        );
      },
    );
  });

  it("recordRunError grava o erro sem mexer na leitura, haja estado ou não", async () => {
    const { account } = await fixtures();
    await repo.recordRunError(account.id, "A corrida falhou: x");
    await expect(repo.getSyncState(account.id)).resolves.toMatchObject({
      lastError: "A corrida falhou: x",
      lastRunAt: null,
      syncedUntil: null,
    });
    const at = new Date("2026-11-25T10:00:00Z");
    await repo.setSyncState({
      googleAccountId: account.id,
      syncedUntil: at,
      startFrom: null,
      lastRunAt: at,
      lastError: null,
    });
    await repo.recordRunError(account.id, "A corrida falhou: y");
    await expect(repo.getSyncState(account.id)).resolves.toMatchObject({
      lastError: "A corrida falhou: y",
      lastRunAt: at,
      syncedUntil: at,
    });
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
    expect(await repo.isLocked("x")).toBe(false);
    expect(await repo.lockState("x")).toBe("free");
    expect(await repo.tryLock("x", 60_000)).toBe(true);
    expect(await repo.isLocked("x")).toBe(true);
    expect(await repo.tryLock("x", 60_000)).toBe(false);
    await repo.unlock("x");
    expect(await repo.isLocked("x")).toBe(false);
    expect(await repo.lockState("x")).toBe("free");
    expect(await repo.tryLock("x", 60_000)).toBe(true);
    expect(await repo.tryLock("y", -1)).toBe(true);
    // Um trinco que expirou sem se soltar distingue-se de um solto.
    expect(await repo.lockState("y")).toBe("expired");
    expect(await repo.tryLock("y", 60_000)).toBe(true); // o anterior já tinha expirado
  });

  it("guarda o estado da sincronização de cada caixa", async () => {
    const { account } = await fixtures();
    const state = {
      googleAccountId: account.id,
      syncedUntil: new Date("2026-11-25T10:00:00Z"),
      startFrom: null,
      lastRunAt: new Date("2026-11-25T10:00:00Z"),
      lastError: null,
    };
    await repo.setSyncState(state);
    await repo.setSyncState({ ...state, lastError: "x" });
    await expect(repo.getSyncState(account.id)).resolves.toMatchObject({ lastError: "x" });
    expect(await repo.listSyncStates()).toHaveLength(1);
  });
});
