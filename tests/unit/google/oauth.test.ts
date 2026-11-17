import { GoogleOAuthClient } from "@/server/integrations/google/oauth";

const config = {
  clientId: "client-1",
  clientSecret: "secret-1",
  redirectUri: "https://app.test/api/google/callback",
};

function fakeFetch(status: number, json: unknown) {
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: new URLSearchParams(String(init?.body ?? "")) });
    return new Response(JSON.stringify(json), { status });
  }) as typeof fetch;
  return { fn, calls };
}

describe("GoogleOAuthClient", () => {
  it("manda a pessoa autorizar com acesso duradouro e as permissões todas", () => {
    const url = new URL(new GoogleOAuthClient(config).authUrl("estado-1"));

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "client-1",
      redirect_uri: "https://app.test/api/google/callback",
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      state: "estado-1",
    });
    const scope = url.searchParams.get("scope")!;
    for (const needed of [
      "calendar.events",
      "gmail.send",
      "gmail.readonly",
      "contacts.readonly",
      "drive.readonly",
    ])
      expect(scope).toContain(needed);
  });

  it("troca o código pelos tokens", async () => {
    const f = fakeFetch(200, {
      access_token: "a1",
      expires_in: 3599,
      refresh_token: "r1",
      scope: "openid",
    });
    const tokens = await new GoogleOAuthClient(config, f.fn).exchangeCode("code-1");

    expect(tokens).toEqual({
      accessToken: "a1",
      expiresIn: 3599,
      refreshToken: "r1",
      scope: "openid",
    });
    expect(f.calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(Object.fromEntries(f.calls[0].body)).toEqual({
      client_id: "client-1",
      client_secret: "secret-1",
      grant_type: "authorization_code",
      code: "code-1",
      redirect_uri: "https://app.test/api/google/callback",
    });
  });

  it("renova o access token; a renovação não traz refresh token novo", async () => {
    const f = fakeFetch(200, { access_token: "a2", expires_in: 3600 });
    const tokens = await new GoogleOAuthClient(config, f.fn).refresh("r1");

    expect(tokens).toMatchObject({ accessToken: "a2", refreshToken: null });
    expect(f.calls[0].body.get("grant_type")).toBe("refresh_token");
  });

  it("um refresh token que já não vale pede para ligar de novo", async () => {
    const f = fakeFetch(400, { error: "invalid_grant" });
    await expect(new GoogleOAuthClient(config, f.fn).refresh("r1")).rejects.toMatchObject({
      status: 409,
      code: "GOOGLE_RECONNECT",
    });
  });

  it("outros erros não mostram o segredo", async () => {
    const f = fakeFetch(401, { error: "invalid_client", error_description: "Unauthorized" });
    const error = await new GoogleOAuthClient(config, f.fn).exchangeCode("c").catch((e) => e);
    expect(error).toMatchObject({ code: "GOOGLE_OAUTH_ERROR" });
    expect(error.message).not.toContain("secret-1");
  });

  it("sem credenciais no ambiente, explica o que falta", () => {
    const client = GoogleOAuthClient.fromEnv({} as NodeJS.ProcessEnv);
    expect(() => client.authUrl("s")).toThrow(
      expect.objectContaining({ code: "GOOGLE_NOT_CONFIGURED" }),
    );
  });

  it("monta o endereço de retorno a partir do APP_URL", () => {
    const client = GoogleOAuthClient.fromEnv({
      GOOGLE_CLIENT_ID: "c",
      GOOGLE_CLIENT_SECRET: "s",
      APP_URL: "https://app.test/",
    } as unknown as NodeJS.ProcessEnv);
    expect(new URL(client.authUrl("s")).searchParams.get("redirect_uri")).toBe(
      "https://app.test/api/google/callback",
    );
  });
});
