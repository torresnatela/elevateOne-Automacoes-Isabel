import { AppError } from "@/server/lib/errors";
import type { Fetch } from "./google-rest.workspace";
import { GOOGLE_SCOPES } from "./workspace";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  /** Para onde o Google devolve a pessoa: `<APP_URL>/api/google/callback`. */
  redirectUri: string;
}

export interface GoogleTokens {
  accessToken: string;
  /** Segundos até o access token deixar de valer. */
  expiresIn: number;
  /** Só vem na primeira autorização (ou com `prompt=consent`). */
  refreshToken: string | null;
  /** As permissões dadas, separadas por espaços. */
  scope: string;
}

/** O Google já não aceita o refresh token (a pessoa tirou o acesso, ou expirou): é preciso ligar de novo. */
export class GoogleReconnectError extends AppError {
  /** Com o endereço da página das integrações, a mensagem diz onde se liga de novo. */
  constructor(connectUrl?: string | null) {
    super(
      connectUrl
        ? `A ligação ao Google expirou. Para ligar a conta de novo: abrir ${connectUrl} e escolher «Ligar conta Google».`
        : "A ligação ao Google expirou. É preciso ligar a conta de novo.",
      409,
      "GOOGLE_RECONNECT",
    );
  }
}

export class GoogleNotConfiguredError extends AppError {
  constructor() {
    super(
      "A ligação ao Google não está configurada (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL).",
      503,
      "GOOGLE_NOT_CONFIGURED",
    );
  }
}

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

/** O OAuth do Google: mandar a pessoa autorizar, trocar o código por tokens, renová-los. */
export interface GoogleOAuth {
  authUrl(state: string): string;
  exchangeCode(code: string): Promise<GoogleTokens>;
  refresh(refreshToken: string): Promise<GoogleTokens>;
  /** O email da conta a que o access token pertence. */
  emailOf(accessToken: string): Promise<string>;
  /** Tira o acesso do lado do Google. Não falha se já não valia. */
  revoke(token: string): Promise<void>;
}

export class GoogleOAuthClient implements GoogleOAuth {
  constructor(
    private readonly config: GoogleOAuthConfig | null,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  /** Com as credenciais do ambiente; sem elas, cada chamada explica o que falta. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): GoogleOAuthClient {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL } = env;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !APP_URL) return new GoogleOAuthClient(null);
    return new GoogleOAuthClient({
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      redirectUri: `${APP_URL.replace(/\/+$/, "")}/api/google/callback`,
    });
  }

  private get settings(): GoogleOAuthConfig {
    if (!this.config) throw new GoogleNotConfiguredError();
    return this.config;
  }

  authUrl(state: string): string {
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
      client_id: this.settings.clientId,
      redirect_uri: this.settings.redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      // offline + consent: para vir sempre um refresh token.
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    }).toString();
    return url.toString();
  }

  exchangeCode(code: string) {
    return this.token({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.settings.redirectUri,
    });
  }

  refresh(refreshToken: string) {
    return this.token({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  private async token(params: Record<string, string>): Promise<GoogleTokens> {
    const res = await this.fetchFn(TOKEN_URL, {
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
      if (data?.error === "invalid_grant") throw new GoogleReconnectError();
      throw new AppError(
        `O Google recusou a autorização: ${data?.error_description ?? data?.error ?? res.status}`,
        502,
        "GOOGLE_OAUTH_ERROR",
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
    const res = await this.fetchFn(USERINFO_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.email)
      throw new AppError("Não foi possível saber que conta Google é.", 502, "GOOGLE_OAUTH_ERROR");
    return data.email as string;
  }

  async revoke(token: string) {
    await this.fetchFn(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    }).catch(() => undefined);
  }
}
