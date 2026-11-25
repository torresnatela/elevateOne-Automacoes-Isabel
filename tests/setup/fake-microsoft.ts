import {
  MicrosoftReconnectError,
  type MicrosoftOAuth,
  type MicrosoftTokens,
} from "@/server/integrations/microsoft/oauth";
import type { OneDrive, OneDriveItem } from "@/server/integrations/microsoft/onedrive";
import type {
  MicrosoftAccount,
  MicrosoftAccountData,
  MicrosoftAccountRepository,
  MicrosoftFolder,
} from "@/server/repositories/microsoft-account.repository";

export class FakeMicrosoftAccountRepository implements MicrosoftAccountRepository {
  accounts = new Map<string, MicrosoftAccount>();
  async findByUserId(userId: string) {
    return this.accounts.get(userId) ?? null;
  }
  async save(account: MicrosoftAccountData) {
    const previous = this.accounts.get(account.userId);
    const saved: MicrosoftAccount = {
      folderDriveId: previous?.folderDriveId ?? null,
      folderItemId: previous?.folderItemId ?? null,
      folderName: previous?.folderName ?? null,
      folderWebUrl: previous?.folderWebUrl ?? null,
      ...account,
      updatedAt: new Date(),
    };
    this.accounts.set(account.userId, saved);
    return saved;
  }
  async updateRefreshToken(userId: string, refreshTokenEncrypted: string) {
    const a = this.accounts.get(userId);
    if (a) a.refreshTokenEncrypted = refreshTokenEncrypted;
  }
  async setFolder(userId: string, folder: MicrosoftFolder | null) {
    const a = this.accounts.get(userId);
    if (!a) return;
    a.folderDriveId = folder?.driveId ?? null;
    a.folderItemId = folder?.itemId ?? null;
    a.folderName = folder?.name ?? null;
    a.folderWebUrl = folder?.webUrl ?? null;
  }
  async delete(userId: string) {
    this.accounts.delete(userId);
  }
}

/** Uma Microsoft de mentira: só o refresh token mais recente vale (rodam a cada renovação). */
export class FakeMicrosoftOAuth implements MicrosoftOAuth {
  current = "refresh-1";
  refreshes = 0;
  exchange: MicrosoftTokens = {
    accessToken: "access-0",
    expiresIn: 3600,
    refreshToken: "refresh-1",
    scope: "openid email profile offline_access User.Read Files.ReadWrite.All",
  };

  authUrl(state: string) {
    return `https://login.microsoftonline.test/authorize?state=${state}`;
  }
  async exchangeCode(code: string) {
    if (code !== "good-code") throw new MicrosoftReconnectError();
    return this.exchange;
  }
  async refresh(refreshToken: string): Promise<MicrosoftTokens> {
    if (refreshToken !== this.current) throw new MicrosoftReconnectError();
    this.refreshes += 1;
    this.current = `refresh-${this.refreshes + 1}`;
    return {
      accessToken: `access-${this.refreshes}`,
      expiresIn: 3600,
      refreshToken: this.current,
      scope: "",
    };
  }
  async emailOf() {
    return "isabel@empresa.com";
  }
}

export const folderItem = (over: Partial<OneDriveItem> = {}): OneDriveItem => ({
  driveId: "drive-1",
  id: "folder-1",
  name: "Documentos da Empresa",
  isFolder: true,
  childCount: 2,
  mimeType: null,
  size: null,
  webUrl: "https://empresa-my.sharepoint.com/folder-1",
  modifiedAt: null,
  parentPath: null,
  ...over,
});

/** Um OneDrive de mentira, que guarda o token com que foi chamado. */
export class FakeOneDrive implements OneDrive {
  tokens: string[] = [];
  constructor(private readonly token: () => Promise<string>) {}
  async resolveFolder(linkOrPath: string) {
    this.tokens.push(await this.token());
    if (linkOrPath.includes("ficheiro")) throw new Error("não é pasta");
    return folderItem();
  }
  async getItem() {
    return folderItem();
  }
  async listChildren() {
    this.tokens.push(await this.token());
    return [folderItem({ id: "f2", name: "Contrato.pdf", isFolder: false })];
  }
  async search() {
    return [];
  }
  async readFile() {
    return { name: "x.txt", mimeType: "text/plain", data: new Uint8Array() };
  }
}
