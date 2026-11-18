import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { GOOGLE_STATE_COOKIE, GoogleController } from "@/server/controllers/google.controller";
import { GoogleNotConfiguredError } from "@/server/integrations/google/oauth";
import { SESSION_COOKIE } from "@/server/models/session.model";
import { GoogleService } from "@/server/services/google.service";
import { createSessionToken } from "@/server/services/session.service";
import { FakeGoogleAccountRepository, FakeGoogleOAuth } from "../../setup/fake-google";

const key = randomBytes(32);

async function request(
  path: string,
  init: { user?: string | null; state?: string; method?: string } = {},
) {
  const cookies: string[] = [];
  if (init.user !== null)
    cookies.push(
      `${SESSION_COOKIE}=${await createSessionToken({ userId: init.user ?? "u1", name: "I", email: "i@e.pt", role: "USER" })}`,
    );
  if (init.state) cookies.push(`${GOOGLE_STATE_COOKIE}=${init.state}`);
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init.method ?? "GET",
    headers: cookies.length ? { cookie: cookies.join("; ") } : {},
  });
}

function setup() {
  const accounts = new FakeGoogleAccountRepository();
  const oauth = new FakeGoogleOAuth();
  const controller = new GoogleController(new GoogleService(accounts, oauth, () => key));
  return { accounts, oauth, controller };
}

// O retorno às integrações é relativo; o endereço do Google é absoluto. Lê-se dos dois modos.
const locationOf = (res: Response) => new URL(res.headers.get("location")!, "http://base.test");

describe("GoogleController", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("401 sem sessão", async () => {
    const { controller } = setup();
    expect(
      (await controller.connect(await request("/api/google/connect", { user: null }))).status,
    ).toBe(401);
    expect(
      (await controller.callback(await request("/api/google/callback?code=x", { user: null })))
        .status,
    ).toBe(401);
    expect((await controller.status(await request("/api/google", { user: null }))).status).toBe(
      401,
    );
  });

  it("manda a pessoa ao Google com um state novo, guardado num cookie httpOnly", async () => {
    const { controller } = setup();
    const res = await controller.connect(await request("/api/google/connect"));

    expect(res.status).toBe(307);
    const state = locationOf(res).searchParams.get("state")!;
    expect(state.length).toBeGreaterThan(20);
    const cookie = res.cookies.get(GOOGLE_STATE_COOKIE)!;
    expect(cookie.value).toBe(state);
    expect(cookie.httpOnly).toBe(true);
  });

  it("no retorno, com o state certo, liga a conta e volta às integrações", async () => {
    const { controller, accounts } = setup();
    const res = await controller.callback(
      await request("/api/google/callback?code=good-code&state=abc123", { state: "abc123" }),
    );

    expect(locationOf(res).pathname + locationOf(res).search).toBe("/integracoes?google=ligado");
    expect(accounts.accounts.get("u1")?.email).toBe("isabel@escritorio.pt");
    expect(res.cookies.get(GOOGLE_STATE_COOKIE)?.maxAge).toBe(0);
  });

  it("volta por um endereço relativo: atrás de um proxy, o servidor não sabe o seu endereço público", async () => {
    const { controller } = setup();
    const res = await controller.callback(
      await request("/api/google/callback?code=good-code&state=s1", { state: "s1" }),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/integracoes?google=ligado");
  });

  it("não liga com o state errado, sem cookie ou sem código", async () => {
    const { controller, accounts } = setup();
    const attempts = [
      await request("/api/google/callback?code=good-code&state=outro", { state: "abc123" }),
      await request("/api/google/callback?code=good-code&state=abc123"),
      await request("/api/google/callback?state=abc123", { state: "abc123" }),
    ];
    for (const req of attempts) {
      const res = await controller.callback(req);
      expect(locationOf(res).searchParams.get("google")).toBe("erro");
    }
    expect(accounts.accounts.size).toBe(0);
  });

  it("quando a pessoa recusa no Google, volta com o aviso e não liga", async () => {
    const { controller, accounts } = setup();
    const res = await controller.callback(
      await request("/api/google/callback?error=access_denied&state=abc123", { state: "abc123" }),
    );
    expect(locationOf(res).searchParams.get("google")).toBe("recusado");
    expect(accounts.accounts.size).toBe(0);
  });

  it("um código que o Google não aceita volta com erro, sem pormenores", async () => {
    const { controller } = setup();
    const res = await controller.callback(
      await request("/api/google/callback?code=mau&state=abc123", { state: "abc123" }),
    );
    expect(locationOf(res).search).toBe("?google=erro");
  });

  it("sem credenciais configuradas, volta às integrações com o aviso", async () => {
    const { controller, oauth } = setup();
    oauth.authUrl = () => {
      throw new GoogleNotConfiguredError();
    };
    const res = await controller.connect(await request("/api/google/connect"));
    expect(locationOf(res).search).toBe("?google=por-configurar");
  });

  it("mostra o estado e desliga", async () => {
    const { controller } = setup();
    await controller.callback(
      await request("/api/google/callback?code=good-code&state=s1", { state: "s1" }),
    );
    const status = await (await controller.status(await request("/api/google"))).json();
    expect(status.google).toMatchObject({ connected: true, email: "isabel@escritorio.pt" });

    expect(
      (await controller.disconnect(await request("/api/google", { method: "DELETE" }))).status,
    ).toBe(200);
    const after = await (await controller.status(await request("/api/google"))).json();
    expect(after.google.connected).toBe(false);
  });

  it("a conta de uma pessoa não aparece a outra", async () => {
    const { controller } = setup();
    await controller.callback(
      await request("/api/google/callback?code=good-code&state=s1", { state: "s1" }),
    );
    const other = await (
      await controller.status(await request("/api/google", { user: "u2" }))
    ).json();
    expect(other.google.connected).toBe(false);
  });
});
