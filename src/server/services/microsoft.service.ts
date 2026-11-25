import {
  MICROSOFT_GRAPH_SCOPES,
  MicrosoftReconnectError,
  normalizeScopes,
  type Fetch,
  type MicrosoftOAuth,
} from "@/server/integrations/microsoft/oauth";
import {
  GraphOneDrive,
  type OneDrive,
  type OneDriveItem,
} from "@/server/integrations/microsoft/onedrive";
import { decryptSecret, encryptSecret } from "@/server/lib/crypto";
import { AppError } from "@/server/lib/errors";
import type {
  MicrosoftAccountRepository,
  MicrosoftFolder,
} from "@/server/repositories/microsoft-account.repository";

export class MicrosoftNotConnectedError extends AppError {
  constructor(connectUrl?: string | null) {
    super(
      connectUrl
        ? `A conta Microsoft ainda não está ligada. Para a ligar: abrir ${connectUrl} e escolher «Ligar conta Microsoft».`
        : "A conta Microsoft ainda não está ligada. Ligue-a em Integrações.",
      409,
      "MICROSOFT_NOT_CONNECTED",
    );
  }
}

export class OneDriveFolderNotSetError extends AppError {
  constructor(connectUrl?: string | null) {
    super(
      connectUrl
        ? `Ainda não foi escolhida a pasta do OneDrive da empresa. Para a escolher: abrir ${connectUrl}.`
        : "Ainda não foi escolhida a pasta do OneDrive da empresa. Escolha-a em Integrações.",
      409,
      "ONEDRIVE_FOLDER_NOT_SET",
    );
  }
}

export interface MicrosoftStatus {
  connected: boolean;
  email: string | null;
  missingScopes: string[];
  /** A pasta da empresa, se já foi escolhida. */
  folder: MicrosoftFolder | null;
}

/** O OneDrive de alguém, já com a pasta da empresa à mão. */
export interface OneDriveAccess {
  drive: OneDrive;
  folder: MicrosoftFolder;
}

const EXPIRY_MARGIN_MS = 60_000;

/** As contas Microsoft ligadas: ligar, escolher a pasta, desligar, e dar acesso ao OneDrive. */
export class MicrosoftService {
  private readonly tokens = new Map<string, { accessToken: string; expiresAt: number }>();

  constructor(
    private readonly accounts: MicrosoftAccountRepository,
    private readonly oauth: MicrosoftOAuth,
    private readonly key: () => Buffer,
    private readonly now: () => number = Date.now,
    private readonly fetchFn: Fetch = fetch,
    private readonly connectUrl: () => string | null = () => null,
    /** Troca-se nos testes: o OneDrive com um dado token. */
    private readonly driveFactory: (token: () => Promise<string>) => OneDrive = (token) =>
      new GraphOneDrive(token, this.fetchFn),
  ) {}

  authUrl(state: string): string {
    return this.oauth.authUrl(state);
  }

  /** O fim da autorização: troca o código pelos tokens e guarda a conta, com o refresh token cifrado. */
  async connect(userId: string, code: string): Promise<MicrosoftStatus> {
    const key = this.key();
    const tokens = await this.oauth.exchangeCode(code);
    if (!tokens.refreshToken)
      throw new AppError(
        "A Microsoft não devolveu um acesso duradouro. Tente ligar de novo.",
        502,
        "MICROSOFT_OAUTH_ERROR",
      );
    const email = await this.oauth.emailOf(tokens.accessToken);
    await this.accounts.save({
      userId,
      email,
      refreshTokenEncrypted: encryptSecret(tokens.refreshToken, key),
      scopes: tokens.scope,
    });
    this.remember(userId, tokens.accessToken, tokens.expiresIn);
    return this.status(userId);
  }

  async status(userId: string): Promise<MicrosoftStatus> {
    const account = await this.accounts.findByUserId(userId);
    if (!account) return { connected: false, email: null, missingScopes: [], folder: null };
    const granted = normalizeScopes(account.scopes);
    return {
      connected: true,
      email: account.email,
      missingScopes: MICROSOFT_GRAPH_SCOPES.filter((s) => !granted.has(s.toLowerCase())),
      folder:
        account.folderDriveId && account.folderItemId
          ? {
              driveId: account.folderDriveId,
              itemId: account.folderItemId,
              name: account.folderName ?? "",
              webUrl: account.folderWebUrl,
            }
          : null,
    };
  }

  /**
   * Desliga do lado do sistema. A Microsoft não tem um «revogar este token» para apps web:
   * a pessoa tira o acesso em myapps.microsoft.com (empresa) ou account.live.com/consent/Manage.
   */
  async disconnect(userId: string): Promise<void> {
    this.tokens.delete(userId);
    await this.accounts.delete(userId);
  }

  /** Escolhe a pasta da empresa (por link de partilha ou caminho) e devolve o que lá está. */
  async setFolder(
    userId: string,
    linkOrPath: string,
  ): Promise<{ folder: MicrosoftFolder; items: OneDriveItem[] }> {
    const drive = await this.driveFor(userId);
    const item = await drive.resolveFolder(linkOrPath);
    const folder: MicrosoftFolder = {
      driveId: item.driveId,
      itemId: item.id,
      name: item.name,
      webUrl: item.webUrl,
    };
    const items = await drive.listChildren(folder.driveId, folder.itemId, 50);
    await this.accounts.setFolder(userId, folder);
    return { folder, items };
  }

  async clearFolder(userId: string): Promise<void> {
    await this.accounts.setFolder(userId, null);
  }

  /** O que está na pasta da empresa (para conferir que a ligação funciona). */
  async folderItems(userId: string, limit = 50): Promise<OneDriveItem[]> {
    const { drive, folder } = await this.oneDriveFor(userId);
    return drive.listChildren(folder.driveId, folder.itemId, limit);
  }

  /** O OneDrive de quem pediu, sem exigir pasta escolhida. */
  async driveFor(userId: string | null): Promise<OneDrive> {
    if (!userId || !(await this.accounts.findByUserId(userId)))
      throw new MicrosoftNotConnectedError(this.connectUrl());
    return this.driveFactory(() => this.accessToken(userId));
  }

  /** O OneDrive e a pasta da empresa: é o que as ferramentas dos agentes vão usar. */
  async oneDriveFor(userId: string | null): Promise<OneDriveAccess> {
    const drive = await this.driveFor(userId);
    const { folder } = await this.status(userId!);
    if (!folder) throw new OneDriveFolderNotSetError(this.connectUrl());
    return { drive, folder };
  }

  /** O access token em dia. A Microsoft roda o refresh token: o novo fica guardado. */
  async accessToken(userId: string): Promise<string> {
    const cached = this.tokens.get(userId);
    if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > this.now()) return cached.accessToken;

    const account = await this.accounts.findByUserId(userId);
    if (!account) throw new MicrosoftNotConnectedError(this.connectUrl());
    const key = this.key();
    try {
      const tokens = await this.oauth.refresh(decryptSecret(account.refreshTokenEncrypted, key));
      if (tokens.refreshToken)
        await this.accounts.updateRefreshToken(userId, encryptSecret(tokens.refreshToken, key));
      this.remember(userId, tokens.accessToken, tokens.expiresIn);
      return tokens.accessToken;
    } catch (error) {
      if (error instanceof MicrosoftReconnectError) {
        this.tokens.delete(userId);
        await this.accounts.delete(userId);
        throw new MicrosoftReconnectError(this.connectUrl());
      }
      throw error;
    }
  }

  private remember(userId: string, accessToken: string, expiresIn: number) {
    this.tokens.set(userId, { accessToken, expiresAt: this.now() + expiresIn * 1000 });
  }
}
