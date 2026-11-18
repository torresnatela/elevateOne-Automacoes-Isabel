import { randomBytes } from "node:crypto";
import { decryptSecret } from "@/server/lib/crypto";
import { GoogleService } from "@/server/services/google.service";
import { FakeGoogleAccountRepository, FakeGoogleOAuth } from "../../setup/fake-google";

const key = randomBytes(32);

function setup() {
  const accounts = new FakeGoogleAccountRepository();
  const oauth = new FakeGoogleOAuth();
  const clock = { now: 1_000_000 };
  const service = new GoogleService(
    accounts,
    oauth,
    () => key,
    () => clock.now,
  );
  return { accounts, oauth, clock, service };
}

describe("GoogleService", () => {
  it("liga a conta e guarda o refresh token cifrado", async () => {
    const t = setup();
    const status = await t.service.connect("u1", "good-code");

    expect(status).toMatchObject({ connected: true, email: "isabel@escritorio.pt" });
    const saved = t.accounts.accounts.get("u1")!;
    expect(saved.refreshTokenEncrypted).not.toContain("refresh-1");
    expect(decryptSecret(saved.refreshTokenEncrypted, key)).toBe("refresh-1");
  });

  it("diz que permissões ficaram por dar", async () => {
    const t = setup();
    t.oauth.exchange = {
      ...t.oauth.exchange,
      scope: "openid https://www.googleapis.com/auth/calendar.events",
    };
    const status = await t.service.connect("u1", "good-code");

    expect(status.missingScopes).toContain("https://www.googleapis.com/auth/gmail.send");
    expect(status.missingScopes).toContain("https://www.googleapis.com/auth/spreadsheets");
    expect(status.missingScopes).not.toContain("https://www.googleapis.com/auth/calendar.events");
    expect(status.missingScopes).not.toContain("openid");
  });

  it("não liga se o Google não der um acesso duradouro", async () => {
    const t = setup();
    t.oauth.exchange = { ...t.oauth.exchange, refreshToken: null };
    await expect(t.service.connect("u1", "good-code")).rejects.toMatchObject({
      code: "GOOGLE_OAUTH_ERROR",
    });
    expect(t.accounts.accounts.size).toBe(0);
  });

  it("não liga sem a chave de cifra, e nem chega a falar com o Google", async () => {
    const t = setup();
    const service = new GoogleService(t.accounts, t.oauth, () => {
      throw new Error("ENCRYPTION_KEY em falta");
    });
    await expect(service.connect("u1", "good-code")).rejects.toThrow(/ENCRYPTION_KEY/);
    expect(t.accounts.accounts.size).toBe(0);
  });

  it("usa o access token guardado até perto de expirar, e depois renova", async () => {
    const t = setup();
    await t.service.connect("u1", "good-code");

    await expect(t.service.accessToken("u1")).resolves.toBe("access-0");
    t.clock.now += 3_550_000; // faltam menos de 60 s para expirar
    await expect(t.service.accessToken("u1")).resolves.toBe("access-1");
    await expect(t.service.accessToken("u1")).resolves.toBe("access-1");
    expect(t.oauth.refreshes).toBe(1);
  });

  it("quando o Google já não aceita o acesso, a conta deixa de estar ligada", async () => {
    const t = setup();
    await t.service.connect("u1", "good-code");
    t.oauth.valid.clear();
    t.clock.now += 4_000_000;

    await expect(t.service.accessToken("u1")).rejects.toMatchObject({ code: "GOOGLE_RECONNECT" });
    await expect(t.service.status("u1")).resolves.toMatchObject({ connected: false });
  });

  it("sem conta ligada, as ferramentas recebem um erro que diz o que fazer", async () => {
    const t = setup();
    await expect(t.service.workspaceFor("u1")).rejects.toMatchObject({
      status: 409,
      code: "GOOGLE_NOT_CONNECTED",
    });
    await expect(t.service.workspaceFor(null)).rejects.toMatchObject({
      code: "GOOGLE_NOT_CONNECTED",
    });
  });

  it("o erro de conta por ligar leva o endereço onde se liga", async () => {
    const service = new GoogleService(
      new FakeGoogleAccountRepository(),
      new FakeGoogleOAuth(),
      () => key,
      undefined,
      undefined,
      () => "https://app.escritorio.pt/integracoes",
    );

    await expect(service.workspaceFor("u1")).rejects.toThrow(
      "https://app.escritorio.pt/integracoes",
    );
  });

  it("quando o acesso expira, o erro leva o endereço onde se liga de novo", async () => {
    const accounts = new FakeGoogleAccountRepository();
    const oauth = new FakeGoogleOAuth();
    const clock = { now: 1_000_000 };
    const service = new GoogleService(
      accounts,
      oauth,
      () => key,
      () => clock.now,
      undefined,
      () => "https://app.escritorio.pt/integracoes",
    );
    await service.connect("u1", "good-code");
    oauth.valid.clear();
    clock.now += 4_000_000;

    await expect(service.accessToken("u1")).rejects.toMatchObject({
      code: "GOOGLE_RECONNECT",
      message: expect.stringContaining("https://app.escritorio.pt/integracoes"),
    });
  });

  it("as ferramentas recebem um acesso que sabe dizer onde se dão as permissões", async () => {
    const denied = (async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "Request had insufficient authentication scopes.",
            status: "PERMISSION_DENIED",
          },
        }),
        { status: 403 },
      )) as typeof fetch;
    const service = new GoogleService(
      new FakeGoogleAccountRepository(),
      new FakeGoogleOAuth(),
      () => key,
      undefined,
      denied,
      () => "https://app.escritorio.pt/integracoes",
    );
    await service.connect("u1", "good-code");

    const workspace = await service.workspaceFor("u1");
    await expect(workspace.readCells("s1", "A1")).rejects.toThrow(
      "https://app.escritorio.pt/integracoes",
    );
  });

  it("desligar tira o acesso do lado do Google e apaga a conta", async () => {
    const t = setup();
    await t.service.connect("u1", "good-code");
    await t.service.disconnect("u1");

    expect(t.oauth.revoked).toEqual(["refresh-1"]);
    await expect(t.service.status("u1")).resolves.toEqual({
      connected: false,
      email: null,
      missingScopes: [],
    });
    await t.service.disconnect("u1");
  });

  it("cada utilizador tem a sua conta", async () => {
    const t = setup();
    await t.service.connect("u1", "good-code");
    await expect(t.service.status("u2")).resolves.toMatchObject({ connected: false });
  });
});
