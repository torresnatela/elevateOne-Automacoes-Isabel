import { MicrosoftOAuthClient, normalizeScopes } from "@/server/integrations/microsoft/oauth";
import { GraphOneDrive, shareIdOf, toItem } from "@/server/integrations/microsoft/onedrive";

const config = {
  clientId: "client-1",
  clientSecret: "secret-1",
  tenant: "common",
  redirectUri: "https://app.test/api/microsoft/callback",
};

function fakeFetch(responses: Array<{ status: number; json?: unknown; body?: string }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const r = responses.shift() ?? { status: 500, json: {} };
    return new Response(r.body ?? JSON.stringify(r.json ?? {}), { status: r.status });
  }) as typeof fetch;
  return { fn, calls };
}

describe("MicrosoftOAuthClient", () => {
  it("manda a pessoa autorizar com offline_access e acesso aos ficheiros", () => {
    const url = new URL(new MicrosoftOAuthClient(config).authUrl("estado-1"));
    expect(url.origin + url.pathname).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "client-1",
      redirect_uri: "https://app.test/api/microsoft/callback",
      response_type: "code",
      state: "estado-1",
    });
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("scope")).toContain("Files.ReadWrite.All");
  });

  it("sem credenciais no ambiente, explica o que falta", () => {
    expect(() => MicrosoftOAuthClient.fromEnv({} as NodeJS.ProcessEnv).authUrl("x")).toThrow(
      /MICROSOFT_CLIENT_ID/,
    );
  });

  it("troca o código pelos tokens", async () => {
    const f = fakeFetch([
      { status: 200, json: { access_token: "a1", expires_in: 3599, refresh_token: "r1", scope: "User.Read" } },
    ]);
    const tokens = await new MicrosoftOAuthClient(config, f.fn).exchangeCode("code-1");
    expect(tokens).toEqual({ accessToken: "a1", expiresIn: 3599, refreshToken: "r1", scope: "User.Read" });
    const body = new URLSearchParams(String(f.calls[0]!.init!.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_secret")).toBe("secret-1");
  });

  it("invalid_grant e interaction_required pedem para ligar de novo", async () => {
    for (const error of ["invalid_grant", "interaction_required"]) {
      const f = fakeFetch([{ status: 400, json: { error } }]);
      await expect(new MicrosoftOAuthClient(config, f.fn).refresh("r")).rejects.toMatchObject({
        code: "MICROSOFT_RECONNECT",
      });
    }
  });

  it("o email vem do mail, ou do nome de início de sessão", async () => {
    const f = fakeFetch([{ status: 200, json: { mail: null, userPrincipalName: "isa@empresa.com" } }]);
    expect(await new MicrosoftOAuthClient(config, f.fn).emailOf("a")).toBe("isa@empresa.com");
  });

  it("normaliza as permissões", () => {
    expect(normalizeScopes("https://graph.microsoft.com/Files.ReadWrite.All User.Read")).toEqual(
      new Set(["files.readwrite.all", "user.read"]),
    );
  });
});

describe("GraphOneDrive", () => {
  const token = async () => "tok";

  it("codifica o link de partilha como o Graph pede", () => {
    // O exemplo da documentação do Microsoft Graph.
    expect(shareIdOf("https://onedrive.live.com/redir?resid=1231244193912!12&authKey=1201919!12921!1")).toBe(
      "u!aHR0cHM6Ly9vbmVkcml2ZS5saXZlLmNvbS9yZWRpcj9yZXNpZD0xMjMxMjQ0MTkzOTEyITEyJmF1dGhLZXk9MTIwMTkxOSExMjkyMSEx",
    );
  });

  it("resolve uma pasta a partir de um link de partilha", async () => {
    const f = fakeFetch([
      {
        status: 200,
        json: { id: "i1", name: "Empresa", folder: { childCount: 3 }, parentReference: { driveId: "d1" }, webUrl: "https://w" },
      },
    ]);
    const item = await new GraphOneDrive(token, f.fn).resolveFolder("https://empresa.sharepoint.com/:f:/g/abc");
    expect(item).toMatchObject({ driveId: "d1", id: "i1", isFolder: true, childCount: 3 });
    expect(f.calls[0]!.url).toContain("/shares/u!");
    expect(new Headers(f.calls[0]!.init!.headers).get("authorization")).toBe("Bearer tok");
  });

  it("resolve uma pasta por caminho no OneDrive da pessoa", async () => {
    const f = fakeFetch([
      { status: 200, json: { id: "i1", name: "Docs", folder: {}, parentReference: { driveId: "d1" } } },
    ]);
    await new GraphOneDrive(token, f.fn).resolveFolder("/Empresa/Docs Importantes/");
    expect(f.calls[0]!.url).toContain("/me/drive/root:/Empresa/Docs%20Importantes?");
  });

  it("recusa um ficheiro no lugar de uma pasta", async () => {
    const f = fakeFetch([{ status: 200, json: { id: "i1", name: "a.pdf", file: {}, parentReference: { driveId: "d1" } } }]);
    await expect(new GraphOneDrive(token, f.fn).resolveFolder("a.pdf")).rejects.toMatchObject({
      code: "ONEDRIVE_NOT_A_FOLDER",
    });
  });

  it("um 404 do Graph é um 404 para quem pediu", async () => {
    const f = fakeFetch([{ status: 404, json: { error: { message: "itemNotFound" } } }]);
    await expect(new GraphOneDrive(token, f.fn).listChildren("d", "i")).rejects.toMatchObject({
      status: 404,
      code: "MICROSOFT_API_ERROR",
    });
  });

  it("um atalho para uma pasta partilhada aponta para o item real", () => {
    expect(
      toItem({
        id: "atalho",
        name: "Empresa",
        remoteItem: { id: "real", folder: { childCount: 1 }, parentReference: { driveId: "outro" } },
      }),
    ).toMatchObject({ id: "real", driveId: "outro", name: "Empresa", isFolder: true });
  });

  it("lê um ficheiro, com limite de tamanho", async () => {
    const f = fakeFetch([
      { status: 200, json: { id: "i", name: "a.txt", size: 5, file: { mimeType: "text/plain" }, parentReference: { driveId: "d" } } },
      { status: 200, body: "olá!" },
    ]);
    const file = await new GraphOneDrive(token, f.fn).readFile("d", "i");
    expect(new TextDecoder().decode(file.data)).toBe("olá!");
    expect(file.mimeType).toBe("text/plain");

    const big = fakeFetch([
      { status: 200, json: { id: "i", name: "a.zip", size: 50e6, file: {}, parentReference: { driveId: "d" } } },
    ]);
    await expect(new GraphOneDrive(token, big.fn).readFile("d", "i")).rejects.toMatchObject({
      code: "ONEDRIVE_FILE_TOO_LARGE",
    });
  });
});
