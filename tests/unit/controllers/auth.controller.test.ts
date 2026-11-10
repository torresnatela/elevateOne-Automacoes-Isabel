import { NextRequest } from "next/server";
import { AuthController } from "@/server/controllers/auth.controller";
import { AuthService } from "@/server/services/auth.service";
import { hashPassword } from "@/server/services/password.service";
import { createSessionToken } from "@/server/services/session.service";
import { SESSION_COOKIE } from "@/server/models/session.model";
import { FakeUserRepository } from "../../setup/fake-user.repository";

function jsonRequest(body: unknown, cookie?: string) {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("AuthController", () => {
  let repo: FakeUserRepository;
  let controller: AuthController;

  beforeEach(async () => {
    repo = new FakeUserRepository();
    controller = new AuthController(new AuthService(repo));
    await repo.create({
      name: "Admin",
      email: "admin@elevateone.local",
      passwordHash: await hashPassword("Admin@123"),
      role: "ADMIN",
    });
  });

  describe("login", () => {
    it("200 + cookie de sessão httpOnly com credenciais válidas", async () => {
      const res = await controller.login(jsonRequest({ email: "admin@elevateone.local", password: "Admin@123" }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user).toMatchObject({ email: "admin@elevateone.local", role: "ADMIN" });
      expect(body.user.passwordHash).toBeUndefined();
      const cookie = res.cookies.get(SESSION_COOKIE);
      expect(cookie?.value).toBeTruthy();
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.sameSite).toBe("lax");
      expect(cookie?.path).toBe("/");
    });

    it("400 com payload inválido", async () => {
      const res = await controller.login(jsonRequest({ email: "x" }));
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    });

    it("400 com JSON malformado", async () => {
      const res = await controller.login(jsonRequest("{nao json"));
      expect(res.status).toBe(400);
    });

    it("401 com senha errada e sem cookie", async () => {
      const res = await controller.login(jsonRequest({ email: "admin@elevateone.local", password: "x" }));
      expect(res.status).toBe(401);
      expect((await res.json()).error.message).toBe("E-mail ou senha inválidos");
      expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
    });
  });

  describe("logout", () => {
    it("200 e expira o cookie", async () => {
      const res = await controller.logout();
      expect(res.status).toBe(200);
      const cookie = res.cookies.get(SESSION_COOKIE);
      expect(cookie?.value).toBe("");
      expect(cookie?.maxAge).toBe(0);
    });
  });

  describe("me", () => {
    it("200 com o usuário da sessão válida", async () => {
      const user = repo.users[0];
      const token = await createSessionToken({ userId: user.id, name: user.name, email: user.email, role: user.role });
      const res = await controller.me(jsonRequest({}, `${SESSION_COOKIE}=${token}`));
      expect(res.status).toBe(200);
      expect((await res.json()).user).toMatchObject({ id: user.id, email: user.email });
    });

    it("401 sem cookie", async () => {
      const res = await controller.me(jsonRequest({}));
      expect(res.status).toBe(401);
    });

    it("401 se o usuário foi desativado após o login", async () => {
      const user = repo.users[0];
      const token = await createSessionToken({ userId: user.id, name: user.name, email: user.email, role: user.role });
      user.active = false;
      const res = await controller.me(jsonRequest({}, `${SESSION_COOKIE}=${token}`));
      expect(res.status).toBe(401);
    });
  });
});
