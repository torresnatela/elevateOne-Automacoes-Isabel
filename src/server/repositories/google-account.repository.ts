import type { PrismaClient } from "@prisma/client";

export interface GoogleAccount {
  userId: string;
  email: string;
  refreshTokenEncrypted: string;
  scopes: string;
  updatedAt: Date;
}

export type GoogleAccountData = Omit<GoogleAccount, "updatedAt">;

/** Uma conta ligada, como o agente de faturas a percorre. */
export interface ConnectedGoogleAccount {
  id: string;
  userId: string;
  email: string;
}

/** Contrato de persistência das contas Google ligadas (uma por utilizador). */
export interface GoogleAccountRepository {
  findByUserId(userId: string): Promise<GoogleAccount | null>;
  /** Todas as contas ligadas. */
  listAll(): Promise<ConnectedGoogleAccount[]>;
  /** Liga ou volta a ligar: a conta nova fica no lugar da anterior. */
  save(account: GoogleAccountData): Promise<GoogleAccount>;
  delete(userId: string): Promise<void>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PrismaGoogleAccountRepository implements GoogleAccountRepository {
  constructor(private readonly db: PrismaClient) {}

  async findByUserId(userId: string) {
    if (!UUID_RE.test(userId)) return null;
    return this.db.googleAccount.findUnique({ where: { userId } });
  }

  async listAll() {
    return this.db.googleAccount.findMany({
      select: { id: true, userId: true, email: true },
      orderBy: { createdAt: "asc" },
    });
  }

  async save(account: GoogleAccountData) {
    const { userId, ...data } = account;
    return this.db.$transaction(async (tx) => {
      // A mesma linha que o agente de faturas trinca antes de gravar: uma corrida a meio
      // termina a escrita antes desta limpeza, ou só escreve depois de ver a caixa nova.
      await tx.$queryRaw`SELECT 1 FROM "google_accounts" WHERE "user_id" = ${userId}::uuid FOR UPDATE`;
      const previous = await tx.googleAccount.findUnique({ where: { userId } });
      // Outra caixa no lugar da anterior: o agente de faturas começa do zero nela, e os emails
      // já guardados deixam de apontar para esta conta (os anexos estão na caixa antiga).
      if (previous && previous.email.toLowerCase() !== data.email.toLowerCase()) {
        await tx.mailSyncState.deleteMany({ where: { googleAccountId: previous.id } });
        await tx.mailSeenMessage.deleteMany({ where: { googleAccountId: previous.id } });
        await tx.clientEmail.updateMany({
          where: { googleAccountId: previous.id },
          data: { googleAccountId: null },
        });
      }
      return tx.googleAccount.upsert({
        where: { userId },
        update: data,
        create: { userId, ...data },
      });
    });
  }

  async delete(userId: string) {
    if (!UUID_RE.test(userId)) return;
    await this.db.googleAccount.deleteMany({ where: { userId } });
  }
}
