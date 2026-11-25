import { AppError } from "@/server/lib/errors";

export type Fetch = typeof fetch;

/**
 * As permissões que se pedem ao ligar a conta Microsoft. `offline_access` é o que dá o
 * refresh token; `Files.ReadWrite.All` chega às pastas da própria pessoa e às partilhadas
 * com ela (a pasta da empresa costuma ser uma destas).
 */
export const MICROSOFT_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "User.Read",
  "Files.ReadWrite.All",
] as const;

/** As permissões do Graph que contam para o estado (as do OpenID vêm sempre). */
export const MICROSOFT_GRAPH_SCOPES = ["User.Read", "Files.ReadWrite.All"] as const;

export interface MicrosoftOAuthConfig {
  clientId: string;
  clientSecret: string;
  /** `common` (contas pessoais e de empresa), `organizations`, ou o id do diretório da empresa. */
  tenant: string;
  /** Para onde a Microsoft devolve a pessoa: `<APP_URL>/api/microsoft/callback`. */
  redirectUri: string;
}

export interface MicrosoftTokens {
  accessToken: string;
  /** Segundos até o access token deixar de valer. */
  expiresIn: number;
  /** A Microsoft devolve um novo a cada renovação: é esse que se guarda. */
  refreshToken: string | null;
  /** As permissões dadas, separadas por espaços. */
  scope: string;
}

/** A Microsoft já não aceita o refresh token (acesso retirado, expirado, ou pede MFA de novo). */
export class MicrosoftReconnectError extends AppError {
  constructor(connectUrl?: string | null) {
    super(
      connectUrl
        ? `A ligação à Microsoft expirou. Para ligar a conta de novo: abrir ${connectUrl} e escolher «Ligar conta Microsoft».`
        : "A ligação à Microsoft expirou. É preciso ligar a conta de novo.",
      409,
      "MICROSOFT_RECONNECT",
    );
  }
}

export class MicrosoftNotConfiguredError extends AppError {
  constructor() {
    super(
      "A ligação à Microsoft não está configurada (MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, APP_URL).",
      503,
      "MICROSOFT_NOT_CONFIGURED",
    );
  }
}

const LOGIN = "https://login.microsoftonline.com";
const ME_URL = "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName";

/** Os erros do token que só se resolvem ligando a conta de novo. */
const RECONNECT_ERRORS = new Set(["invalid_grant", "interaction_required", "consent_required"]);

/** O OAuth da Microsoft (Entra ID): mandar a pessoa autorizar, trocar o código, renovar. */
export interface MicrosoftOAuth {
  authUrl(state: string): string;
  exchangeCode(code: string): Promise<MicrosoftTokens>;
  refresh(refreshToken: string): Promise<MicrosoftTokens>;
  /** O email (ou nome de início de sessão) da conta a que o access token pertence. */
  emailOf(accessToken: string): Promise<string>;
}

export class MicrosoftOAuthClient implements MicrosoftOAuth {
  constructor(
    private readonly config: MicrosoftOAuthConfig | null,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  /** Com as credenciais do ambiente; sem elas, cada chamada explica o que falta. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): MicrosoftOAuthClient {
    const { MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT_ID, APP_URL } = env;
    if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET || !APP_URL)
      return new MicrosoftOAuthClient(null);
    return new MicrosoftOAuthClient({
      clientId: MICROSOFT_CLIENT_ID,
      clientSecret: MICROSOFT_CLIENT_SECRET,
      tenant: MICROSOFT_TENANT_ID || "common",
      redirectUri: `${APP_URL.replace(/\/+$/, "")}/api/microsoft/callback`,
    });
  }

  private get settings(): MicrosoftOAuthConfig {
    if (!this.config) throw new MicrosoftNotConfiguredError();
    return this.config;
  }

  private endpoint(path: "authorize" | "token") {
    return `${LOGIN}/${encodeURIComponent(this.settings.tenant)}/oauth2/v2.0/${path}`;
  }

  authUrl(state: string): string {
    const url = new URL(this.endpoint("authorize"));
    url.search = new URLSearchParams({
      client_id: this.settings.clientId,
      redirect_uri: this.settings.redirectUri,
      response_type: "code",
      response_mode: "query",
      scope: MICROSOFT_SCOPES.join(" "),
      // Deixa escolher a conta (a da empresa, não a pessoal que já estava aberta).
      prompt: "select_account",
      state,
    }).toString();
    return url.toString();
  }

  exchangeCode(code: string) {
    return this.token({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.settings.redirectUri,
      scope: MICROSOFT_SCOPES.join(" "),
    });
  }

  refresh(refreshToken: string) {
    return this.token({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: MICROSOFT_SCOPES.join(" "),
    });
  }

  private async token(params: Record<string, string>): Promise<MicrosoftTokens> {
    const res = await this.fetchFn(this.endpoint("token"), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.settings.clientId,
        client_secret: this.settings.clientSecret,
        ...params,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (RECONNECT_ERRORS.has(data?.error)) throw new MicrosoftReconnectError();
      throw new AppError(
        `A Microsoft recusou a autorização: ${data?.error_description ?? data?.error ?? res.status}`,
        502,
        "MICROSOFT_OAUTH_ERROR",
      );
    }
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in ?? 3600,
      refreshToken: data.refresh_token ?? null,
      scope: data.scope ?? "",
    };
  }

  async emailOf(accessToken: string) {
    const res = await this.fetchFn(ME_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json().catch(() => null);
    const email = data?.mail ?? data?.userPrincipalName;
    if (!res.ok || !email)
      throw new AppError(
        "Não foi possível saber que conta Microsoft é.",
        502,
        "MICROSOFT_OAUTH_ERROR",
      );
    return email as string;
  }
}

/** As permissões do Graph, sem o prefixo e em minúsculas, para comparar. */
export const normalizeScopes = (scope: string) =>
  new Set(
    scope
      .split(/\s+/)
      .filter(Boolean)
      .map((s) => s.replace(/^https:\/\/graph\.microsoft\.com\//i, "").toLowerCase()),
  );
