import {
  GoogleRestWorkspace,
  type Fetch,
} from "@/server/integrations/google/google-rest.workspace";
import { GoogleReconnectError, type GoogleOAuth } from "@/server/integrations/google/oauth";
import { GOOGLE_SCOPES, type GoogleWorkspace } from "@/server/integrations/google/workspace";
import { decryptSecret, encryptSecret } from "@/server/lib/crypto";
import { AppError } from "@/server/lib/errors";
import type { GoogleAccountRepository } from "@/server/repositories/google-account.repository";

export class GoogleNotConnectedError extends AppError {
  /** Com o endereço da página das integrações, a mensagem diz onde se liga. */
  constructor(connectUrl?: string | null) {
    super(
      connectUrl
        ? `A conta Google ainda não está ligada. Para a ligar: abrir ${connectUrl} e escolher «Ligar conta Google».`
        : "A conta Google ainda não está ligada. Ligue-a em Integrações.",
      409,
      "GOOGLE_NOT_CONNECTED",
    );
  }
}

export interface GoogleStatus {
  connected: boolean;
  email: string | null;
  /** As permissões pedidas que a pessoa não deu (com elas em falta, algumas ferramentas falham). */
  missingScopes: string[];
}

/** De onde as ferramentas tiram a conta Google de quem fala com o agente. */
export interface GoogleWorkspaceProvider {
  workspaceFor(userId: string | null): Promise<GoogleWorkspace>;
}

/** Uns segundos de folga, para não usar um token a expirar a meio de um pedido. */
const EXPIRY_MARGIN_MS = 60_000;

/** As contas Google ligadas: ligar, desligar e dar às ferramentas um acesso com o token em dia. */
export class GoogleService implements GoogleWorkspaceProvider {
  private readonly tokens = new Map<string, { accessToken: string; expiresAt: number }>();

  constructor(
    private readonly accounts: GoogleAccountRepository,
    private readonly oauth: GoogleOAuth,
    /** A chave que cifra os refresh tokens (só se lê quando é precisa). */
    private readonly key: () => Buffer,
    private readonly now: () => number = Date.now,
    private readonly fetchFn: Fetch = fetch,
    /** O endereço da página das integrações, para os erros dizerem onde se resolve. */
    private readonly connectUrl: () => string | null = () => null,
  ) {}

  authUrl(state: string): string {
    return this.oauth.authUrl(state);
  }

  /** O fim da autorização: troca o código pelos tokens e guarda a conta, com o refresh token cifrado. */
  async connect(userId: string, code: string): Promise<GoogleStatus> {
    const key = this.key();
    const tokens = await this.oauth.exchangeCode(code);
    if (!tokens.refreshToken)
      throw new AppError(
        "O Google não devolveu um acesso duradouro. Tente ligar de novo.",
        502,
        "GOOGLE_OAUTH_ERROR",
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

  async status(userId: string): Promise<GoogleStatus> {
    const account = await this.accounts.findByUserId(userId);
    if (!account) return { connected: false, email: null, missingScopes: [] };
    const granted = new Set(account.scopes.split(/\s+/));
    return {
      connected: true,
      email: account.email,
      // O Google devolve «email» como o URL da permissão: não conta como em falta.
      missingScopes: GOOGLE_SCOPES.filter(
        (scope) => scope.startsWith("https://") && !granted.has(scope),
      ),
    };
  }

  async disconnect(userId: string): Promise<void> {
    const account = await this.accounts.findByUserId(userId);
    if (!account) return;
    try {
      await this.oauth.revoke(decryptSecret(account.refreshTokenEncrypted, this.key()));
    } catch {
      // Sem conseguir decifrar ou revogar, a conta sai na mesma daqui.
    }
    this.tokens.delete(userId);
    await this.accounts.delete(userId);
  }

  async workspaceFor(userId: string | null): Promise<GoogleWorkspace> {
    if (!userId || !(await this.accounts.findByUserId(userId)))
      throw new GoogleNotConnectedError(this.connectUrl());
    return new GoogleRestWorkspace(() => this.accessToken(userId), this.fetchFn, this.connectUrl());
  }

  /** O access token em dia: o guardado, ou um novo pedido com o refresh token. */
  async accessToken(userId: string): Promise<string> {
    const cached = this.tokens.get(userId);
    if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > this.now()) return cached.accessToken;

    const account = await this.accounts.findByUserId(userId);
    if (!account) throw new GoogleNotConnectedError(this.connectUrl());
    try {
      const tokens = await this.oauth.refresh(
        decryptSecret(account.refreshTokenEncrypted, this.key()),
      );
      this.remember(userId, tokens.accessToken, tokens.expiresIn);
      return tokens.accessToken;
    } catch (error) {
      if (error instanceof GoogleReconnectError) {
        // O acesso morreu do lado do Google: a conta deixa de contar como ligada.
        this.tokens.delete(userId);
        await this.accounts.delete(userId);
        throw new GoogleReconnectError(this.connectUrl());
      }
      throw error;
    }
  }

  private remember(userId: string, accessToken: string, expiresIn: number) {
    this.tokens.set(userId, { accessToken, expiresAt: this.now() + expiresIn * 1000 });
  }
}
