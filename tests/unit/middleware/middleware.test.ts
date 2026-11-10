import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { SESSION_COOKIE } from "@/server/models/session.model";
import type { Role } from "@/server/models/user.model";
import { createSessionToken } from "@/server/services/session.service";

async function cookieFor(role: Role) {
  const token = await createSessionToken({ userId: "u1", name: "N", email: "n@n.com", role });
  return `${SESSION_COOKIE}=${token}`;
}

function req(path: string, cookie?: string) {
  return new NextRequest(`http://localhost${path}`, { headers: cookie ? { cookie } : {} });
}

describe("middleware", () => {
  it("redireciona página protegida para /login (com next) sem sessão", async () => {
    const res = await middleware(req("/dashboard?x=1"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/dashboard?x=1");
  });

  it("retorna 401 JSON para API protegida sem sessão", async () => {
    const res = await middleware(req("/api/qualquer"));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("ignora cookie inválido (trata como sem sessão)", async () => {
    const res = await middleware(req("/dashboard", `${SESSION_COOKIE}=lixo`));
    expect(res.status).toBe(307);
  });

  it("deixa passar rota protegida com sessão válida", async () => {
    const res = await middleware(req("/dashboard", await cookieFor("USER")));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("deixa passar rotas públicas sem sessão", async () => {
    for (const path of ["/login", "/api/auth/login"]) {
      const res = await middleware(req(path));
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("bloqueia /admin para USER com 403", async () => {
    const res = await middleware(req("/admin", await cookieFor("USER")));
    expect(res.status).toBe(403);
  });

  it("bloqueia /api/admin para USER com 403 JSON", async () => {
    const res = await middleware(req("/api/admin/users", await cookieFor("USER")));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  it("libera /admin para ADMIN", async () => {
    const res = await middleware(req("/admin", await cookieFor("ADMIN")));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
