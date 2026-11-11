import type { NextRequest } from "next/server";
import { SESSION_COOKIE, type Session } from "@/server/models/session.model";
import type { Role } from "@/server/models/user.model";
import { requireRole } from "@/server/policies/authorization";
import { verifySessionToken } from "@/server/services/session.service";

/** A sessão do pedido, com o papel exigido: 401 sem sessão, 403 sem o papel. */
export async function requireSession(req: NextRequest, role: Role = "USER"): Promise<Session> {
  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  return requireRole(session, role);
}
