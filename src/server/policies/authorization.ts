import { AppError } from "@/server/lib/errors";
import type { Session } from "@/server/models/session.model";
import type { Role } from "@/server/models/user.model";

export class UnauthorizedError extends AppError {
  constructor() {
    super("Não autenticado", 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor() {
    super("Acesso negado", 403, "FORBIDDEN");
  }
}

/** Hierarquia: quanto maior, mais permissões. ADMIN herda tudo de USER. */
const ROLE_LEVEL: Record<Role, number> = { USER: 1, ADMIN: 2 };

/** Ações conhecidas e o papel mínimo exigido. Novas features registram aqui. */
const PERMISSIONS = {
  "dashboard:view": "USER",
  "admin:access": "ADMIN",
} as const satisfies Record<string, Role>;

export type Action = keyof typeof PERMISSIONS;

export function hasRole(session: Session | null | undefined, role: Role): boolean {
  return !!session && ROLE_LEVEL[session.role] >= ROLE_LEVEL[role];
}

export function can(session: Session | null | undefined, action: Action): boolean {
  return hasRole(session, PERMISSIONS[action]);
}

export function requireRole(session: Session | null | undefined, role: Role): Session {
  if (!session) throw new UnauthorizedError();
  if (!hasRole(session, role)) throw new ForbiddenError();
  return session;
}
