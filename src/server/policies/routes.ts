import type { Role } from "@/server/models/user.model";

/** Rotas acessíveis sem sessão. */
export const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/forbidden",
  // Os webhooks não têm sessão: cada um confere o seu próprio segredo.
  "/api/webhooks",
  // O AI Office lê os eventos com o seu próprio token, sem sessão.
  "/api/office",
  "/api/health",
];

/** Regras de papel mínimo por prefixo de rota (verificadas no middleware). */
export const ROUTE_ROLES: { prefix: string; role: Role }[] = [
  { prefix: "/admin", role: "ADMIN" },
  { prefix: "/api/admin", role: "ADMIN" },
];

const matches = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => matches(pathname, p));
}

export function requiredRoleFor(pathname: string): Role | null {
  return ROUTE_ROLES.find((r) => matches(pathname, r.prefix))?.role ?? null;
}
