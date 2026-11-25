import { randomBytes } from "node:crypto";
import { decryptSecret } from "@/server/lib/crypto";
import { MicrosoftService } from "@/server/services/microsoft.service";
import {
  FakeMicrosoftAccountRepository,
  FakeMicrosoftOAuth,
  FakeOneDrive,
} from "../../setup/fake-microsoft";

const key = randomBytes(32);

function setup() {
  const accounts = new FakeMicrosoftAccountRepository();
  const oauth = new FakeMicrosoftOAuth();
  const clock = { now: 1_000_000 };
  const drives: FakeOneDrive[] = [];
  const service = new MicrosoftService(
    accounts,
    oauth,
    () => key,
    () => clock.now,
    undefined,
    () => "https://app.test/integracoes",
    (token) => {
      const d = new FakeOneDrive(token);
      drives.push(d);
      return d;
    },
  );
  return { accounts, oauth, clock, service, drives };
}

describe("MicrosoftService", () => {
  it("liga a conta e guarda o refresh token cifrado", async () => {
    const t = setup();
    const status = await t.service.connect("u1", "good-code");

    expect(status).toMatchObject({
      connected: true,
      email: "isabel@empresa.com",
      missingScopes: [],
      folder: null,
    });
    const saved = t.accounts.accounts.get("u1")!;
    expect(saved.refreshTokenEncrypted).not.toContain("refresh-1");
    expect(decryptSecret(saved.refreshTokenEncrypted, key)).toBe("refresh-1");
  });

  it("diz que falta o acesso aos ficheiros, com ou sem o prefixo do Graph", async () => {
    const t = setup();
    t.oauth.exchange = { ...t.oauth.exchange, scope: "openid https://graph.microsoft.com/User.Read" };
    const status = await t.service.connect("u1", "good-code");
    expect(status.missingScopes).toEqual(["Files.ReadWrite.All"]);
  });

  it("não liga se a Microsoft não der um acesso duradouro", async () => {
    const t = setup();
    t.oauth.exchange = { ...t.oauth.exchange, refreshToken: null };
    await expect(t.service.connect("u1", "good-code")).rejects.toMatchObject({
      code: "MICROSOFT_OAUTH_ERROR",
    });
    expect(t.accounts.accounts.size).toBe(0);
  });

  it("renova o token e guarda o refresh token novo (a Microsoft roda-os)", async () => {
    const t = setup();
    await t.service.connect("u1", "good-code");
    t.clock.now += 3600_000;

    expect(await t.service.accessToken("u1")).toBe("access-1");
    expect(decryptSecret(t.accounts.accounts.get("u1")!.refreshTokenEncrypted, key)).toBe(
      "refresh-2",
    );

    t.clock.now += 3600_000;
    expect(await t.service.accessToken("u1")).toBe("access-2");
  });

  it("usa o token guardado enquanto vale", async () => {
    const t = setup();
    await t.service.connect("u1", "good-code");
    expect(await t.service.accessToken("u1")).toBe("access-0");
    expect(t.oauth.refreshes).toBe(0);
  });

  it("se a Microsoft já não aceita o acesso, a conta sai e o erro diz onde ligar", async () => {
    const t = setup();
    await t.service.connect("u1", "good-code");
    t.oauth.current = "outro";
    t.clock.now += 3600_000;

    await expect(t.service.accessToken("u1")).rejects.toThrow(/app\.test\/integracoes/);
    expect(t.accounts.accounts.has("u1")).toBe(false);
  });

  it("escolhe a pasta da empresa e devolve o que lá está", async () => {
    const t = setup();
    await t.service.connect("u1", "good-code");
    const { folder, items } = await t.service.setFolder("u1", "https://empresa/:f:/pasta");

    expect(folder).toMatchObject({ driveId: "drive-1", itemId: "folder-1" });
    expect(items.map((i) => i.name)).toEqual(["Contrato.pdf"]);
    expect((await t.service.status("u1")).folder?.name).toBe("Documentos da Empresa");
    expect(t.drives[0]!.tokens).toEqual(["access-0", "access-0"]);
  });

  it("a pasta mantém-se ao ligar a conta de novo, e sai ao limpar", async () => {
    const t = setup();
    await t.service.connect("u1", "good-code");
    await t.service.setFolder("u1", "Empresa/Documentos");
    await t.service.connect("u1", "good-code");
    expect((await t.service.status("u1")).folder).not.toBeNull();

    await t.service.clearFolder("u1");
    expect((await t.service.status("u1")).folder).toBeNull();
  });

  it("sem conta ligada, ou sem pasta, os erros dizem o que fazer", async () => {
    const t = setup();
    await expect(t.service.oneDriveFor("u1")).rejects.toMatchObject({
      code: "MICROSOFT_NOT_CONNECTED",
    });
    await expect(t.service.oneDriveFor(null)).rejects.toMatchObject({
      code: "MICROSOFT_NOT_CONNECTED",
    });
    await t.service.connect("u1", "good-code");
    await expect(t.service.oneDriveFor("u1")).rejects.toMatchObject({
      code: "ONEDRIVE_FOLDER_NOT_SET",
    });
  });

  it("desligar apaga a conta", async () => {
    const t = setup();
    await t.service.connect("u1", "good-code");
    await t.service.disconnect("u1");
    expect((await t.service.status("u1")).connected).toBe(false);
  });
});
