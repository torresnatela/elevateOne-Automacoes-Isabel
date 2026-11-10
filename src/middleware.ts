import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/server/models/session.model";
import { hasRole } from "@/server/policies/authorization";
import { isPublicPath, requiredRoleFor } from "@/server/policies/routes";
import { verifySessionToken } from "@/server/services/session.service";

const isApi = (pathname: string) => pathname.startsWith("/api/");

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

/**
 * Camada de proteção global: autenticação (sessão válida) e autorização
 * por prefixo de rota. Checagens finas ficam nas policies/controllers.
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  // Rotas públicas. Obs.: o redirect "já logado -> /dashboard" fica na página
  // de login, que confere no banco se o usuário ainda está ativo.
  if (isPublicPath(pathname)) return NextResponse.next();

  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    if (isApi(pathname)) return jsonError(401, "UNAUTHORIZED", "Não autenticado");
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  const role = requiredRoleFor(pathname);
  if (role && !hasRole(session, role)) {
    if (isApi(pathname)) return jsonError(403, "FORBIDDEN", "Acesso negado");
    return NextResponse.rewrite(new URL("/forbidden", req.url), { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
