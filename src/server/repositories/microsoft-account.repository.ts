import type { PrismaClient } from "@prisma/client";

export interface MicrosoftFolder {
  driveId: string;
  itemId: string;
  name: string;
  webUrl: string | null;
}

export interface MicrosoftAccount {
  userId: string;
  email: string;
  refreshTokenEncrypted: string;
  scopes: string;
  folderDriveId: string | null;
  folderItemId: string | null;
  folderName: string | null;
  folderWebUrl: string | null;
  updatedAt: Date;
}

export interface MicrosoftAccountData {
  userId: string;
  email: string;
  refreshTokenEncrypted: string;
  scopes: string;
}

/** Contrato de persistência das contas Microsoft ligadas (uma por utilizador). */
export interface MicrosoftAccountRepository {
  findByUserId(userId: string): Promise<MicrosoftAccount | null>;
  /** Liga ou volta a ligar. A pasta escolhida mantém-se. */
  save(account: MicrosoftAccountData): Promise<MicrosoftAccount>;
  /** Guarda o refresh token novo que a Microsoft devolve a cada renovação. */
  updateRefreshToken(userId: string, refreshTokenEncrypted: string): Promise<void>;
  setFolder(userId: string, folder: MicrosoftFolder | null): Promise<void>;
  delete(userId: string): Promise<void>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PrismaMicrosoftAccountRepository implements MicrosoftAccountRepository {
  constructor(private readonly db: PrismaClient) {}

  async findByUserId(userId: string) {
    if (!UUID_RE.test(userId)) return null;
    return this.db.microsoftAccount.findUnique({ where: { userId } });
  }

  async save(account: MicrosoftAccountData) {
    const { userId, ...data } = account;
    return this.db.microsoftAccount.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
  }

  async updateRefreshToken(userId: string, refreshTokenEncrypted: string) {
    await this.db.microsoftAccount.updateMany({ where: { userId }, data: { refreshTokenEncrypted } });
  }

  async setFolder(userId: string, folder: MicrosoftFolder | null) {
    await this.db.microsoftAccount.updateMany({
      where: { userId },
      data: {
        folderDriveId: folder?.driveId ?? null,
        folderItemId: folder?.itemId ?? null,
        folderName: folder?.name ?? null,
        folderWebUrl: folder?.webUrl ?? null,
      },
    });
  }

  async delete(userId: string) {
    if (!UUID_RE.test(userId)) return;
    await this.db.microsoftAccount.deleteMany({ where: { userId } });
  }
}
