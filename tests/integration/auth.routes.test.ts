import { NextRequest } from "next/server";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { SESSION_COOKIE } from "@/server/models/session.model";
import { hashPassword } from "@/server/services/password.service";
import { prisma, resetDatabase } from "../setup/db";

vi.mock("server-only", () => ({}));

function req(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

describe("rotas /api/auth (Postgres real)", () => {
  beforeEach(async () => {
    await resetDatabase();
    await prisma.user.create({
      data: {
        name: "Admin",
        email: "admin@elevateone.local",
        passwordHash: await hashPassword("Admin@123"),
        role: "ADMIN",
      },
    });
  });
  afterAll(() => prisma.$disconnect());

  it("login -> me -> logout", async () => {
    const loginRes = await login(
      req("/api/auth/login", {
        method: "POST",
        body: { email: "admin@elevateone.local", password: "Admin@123" },
      }),
    );
    expect(loginRes.status).toBe(200);
    const token = loginRes.cookies.get(SESSION_COOKIE)?.value;
    expect(token).toBeTruthy();

    const meRes = await me(req("/api/auth/me", { cookie: `${SESSION_COOKIE}=${token}` }));
    expect(meRes.status).toBe(200);
    expect((await meRes.json()).user).toMatchObject({
      email: "admin@elevateone.local",
      role: "ADMIN",
    });

    const logoutRes = await logout();
    expect(logoutRes.cookies.get(SESSION_COOKIE)?.maxAge).toBe(0);
  });

  it("login com senha errada retorna 401", async () => {
    const res = await login(
      req("/api/auth/login", {
        method: "POST",
        body: { email: "admin@elevateone.local", password: "nope" },
      }),
    );
    expect(res.status).toBe(401);
  });
});
