import { NextRequest } from "next/server";
import { AuthController } from "@/server/controllers/auth.controller";
import { UserAdminController } from "@/server/controllers/user-admin.controller";
import { RateLimiter } from "@/server/lib/rate-limiter";
import { SESSION_COOKIE } from "@/server/models/session.model";
import type { Role, User } from "@/server/models/user.model";
import { AuthService } from "@/server/services/auth.service";
import { hashPassword, verifyPassword } from "@/server/services/password.service";
import { createSessionToken } from "@/server/services/session.service";
import { UserAdminService } from "@/server/services/user-admin.service";
import { FakeUserRepository } from "../../setup/fake-user.repository";

async function request(
  init: { as?: Pick<User, "id" | "role">; body?: unknown; ip?: string; method?: string } = {},
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.as) {
    const token = await createSessionToken({
      userId: init.as.id,
      name: "N",
      email: "n@n.pt",
      role: init.as.role as Role,
    });
    headers.cookie = `${SESSION_COOKIE}=${token}`;
  }
  if (init.ip) headers["x-forwarded-for"] = init.ip;
  return new NextRequest("http://localhost/api/x", {
    method: init.method ?? "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function setup() {
  const users = new FakeUserRepository();
  const admin = await users.create({
    name: "Isabel",
    email: "isabel@e.pt",
    passwordHash: await hashPassword("Senha-da-Isabel-1"),
    role: "ADMIN",
  });
  const rui = await users.create({
    name: "Rui",
    email: "rui@e.pt",
    passwordHash: await hashPassword("Senha-do-Rui-1"),
  });
  const clock = { now: 1_000_000 };
  const auth = new AuthController(
    new AuthService(users),
    new RateLimiter(3, 60_000, () => clock.now),
  );
  const admins = new UserAdminController(new UserAdminService(users));
  return { users, admin, rui, clock, auth, admins };
}

describe("o admin gere os utilizadores", () => {
  it("cria um utilizador que consegue entrar, sem devolver a senha", async () => {
    const t = await setup();
    const res = await t.admins.create(
      await request({
        as: t.admin,
        body: { name: " Ana ", email: "ANA@e.pt", password: "Senha-da-Ana-1" },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.user).toMatchObject({ name: "Ana", email: "ana@e.pt", role: "USER", active: true });
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|Senha-da-Ana/);
    const login = await t.auth.login(
      await request({ body: { email: "ana@e.pt", password: "Senha-da-Ana-1" } }),
    );
    expect(login.status).toBe(200);
  });

  it("recusa um e-mail repetido, uma senha curta e quem não é admin", async () => {
    const t = await setup();
    const create = async (as: Pick<User, "id" | "role">, body: unknown) =>
      (await t.admins.create(await request({ as, body }))).status;

    expect(await create(t.admin, { name: "X", email: "rui@e.pt", password: "Senha-nova-1" })).toBe(
      409,
    );
    expect(await create(t.admin, { name: "X", email: "x@e.pt", password: "curta" })).toBe(400);
    expect(await create(t.rui, { name: "X", email: "x@e.pt", password: "Senha-nova-1" })).toBe(403);
    expect(t.users.users).toHaveLength(2);
  });

  it("desativa e reativa um utilizador; quem está desativado não entra", async () => {
    const t = await setup();
    const off = await t.admins.setActive(
      await request({ as: t.admin, body: { active: false }, method: "PUT" }),
      t.rui.id,
    );
    expect(off.status).toBe(200);
    const login = await t.auth.login(
      await request({ body: { email: "rui@e.pt", password: "Senha-do-Rui-1" } }),
    );
    expect(login.status).toBe(401);

    await t.admins.setActive(
      await request({ as: t.admin, body: { active: true }, method: "PUT" }),
      t.rui.id,
    );
    expect((await t.users.findById(t.rui.id))?.active).toBe(true);
  });

  it("ninguém se desativa a si próprio", async () => {
    const t = await setup();
    const res = await t.admins.setActive(
      await request({ as: t.admin, body: { active: false }, method: "PUT" }),
      t.admin.id,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("CANNOT_DEACTIVATE_SELF");
    expect((await t.users.findById(t.admin.id))?.active).toBe(true);
  });

  it("repõe a senha de alguém", async () => {
    const t = await setup();
    const res = await t.admins.resetPassword(
      await request({ as: t.admin, body: { password: "Senha-reposta-1" }, method: "PUT" }),
      t.rui.id,
    );
    expect(res.status).toBe(200);
    const rui = await t.users.findById(t.rui.id);
    await expect(verifyPassword("Senha-reposta-1", rui!.passwordHash)).resolves.toBe(true);

    const missing = await t.admins.resetPassword(
      await request({ as: t.admin, body: { password: "Senha-reposta-1" }, method: "PUT" }),
      "nao-existe",
    );
    expect(missing.status).toBe(404);
    const byUser = await t.admins.resetPassword(
      await request({ as: t.rui, body: { password: "Senha-reposta-1" }, method: "PUT" }),
      t.admin.id,
    );
    expect(byUser.status).toBe(403);
  });
});

describe("cada pessoa troca a sua senha", () => {
  const change = (currentPassword: string, newPassword: string) => ({
    currentPassword,
    newPassword,
  });

  it("troca com a senha atual certa", async () => {
    const t = await setup();
    const res = await t.auth.changePassword(
      await request({
        as: t.rui,
        body: change("Senha-do-Rui-1", "Senha-nova-do-Rui"),
        method: "PUT",
      }),
    );
    expect(res.status).toBe(200);
    const rui = await t.users.findById(t.rui.id);
    await expect(verifyPassword("Senha-nova-do-Rui", rui!.passwordHash)).resolves.toBe(true);
  });

  it("não troca com a senha atual errada, com uma nova curta ou sem sessão", async () => {
    const t = await setup();
    const before = (await t.users.findById(t.rui.id))!.passwordHash;

    const wrong = await t.auth.changePassword(
      await request({ as: t.rui, body: change("errada", "Senha-nova-do-Rui"), method: "PUT" }),
    );
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error.code).toBe("INVALID_CURRENT_PASSWORD");
    const short = await t.auth.changePassword(
      await request({ as: t.rui, body: change("Senha-do-Rui-1", "curta"), method: "PUT" }),
    );
    expect(short.status).toBe(400);
    const anonymous = await t.auth.changePassword(
      await request({ body: change("Senha-do-Rui-1", "Senha-nova-do-Rui"), method: "PUT" }),
    );
    expect(anonymous.status).toBe(401);
    expect((await t.users.findById(t.rui.id))!.passwordHash).toBe(before);
  });
});

describe("limite de tentativas no login", () => {
  const attempt = (t: Awaited<ReturnType<typeof setup>>, password: string, ip = "1.1.1.1") =>
    request({ body: { email: "rui@e.pt", password }, ip }).then((req) => t.auth.login(req));

  it("trava depois de várias senhas erradas, mesmo que a seguinte esteja certa", async () => {
    const t = await setup();
    for (let i = 0; i < 3; i++) expect((await attempt(t, "errada")).status).toBe(401);

    const blocked = await attempt(t, "Senha-do-Rui-1");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect(blocked.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("destrava quando o tempo passa", async () => {
    const t = await setup();
    for (let i = 0; i < 3; i++) await attempt(t, "errada");
    t.clock.now += 60_000;
    expect((await attempt(t, "Senha-do-Rui-1")).status).toBe(200);
  });

  it("um login certo limpa as falhas anteriores", async () => {
    const t = await setup();
    await attempt(t, "errada");
    await attempt(t, "errada");
    expect((await attempt(t, "Senha-do-Rui-1")).status).toBe(200);
    await attempt(t, "errada");
    await attempt(t, "errada");
    expect((await attempt(t, "Senha-do-Rui-1")).status).toBe(200);
  });

  it("não trava outra pessoa nem o mesmo e-mail a partir de outro endereço", async () => {
    const t = await setup();
    for (let i = 0; i < 3; i++) await attempt(t, "errada");

    expect((await attempt(t, "Senha-do-Rui-1", "2.2.2.2")).status).toBe(200);
    const isabel = await t.auth.login(
      await request({
        body: { email: "isabel@e.pt", password: "Senha-da-Isabel-1" },
        ip: "1.1.1.1",
      }),
    );
    expect(isabel.status).toBe(200);
  });
});
