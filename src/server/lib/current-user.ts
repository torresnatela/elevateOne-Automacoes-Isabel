import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { authService } from "@/server/container";
import { SESSION_COOKIE } from "@/server/models/session.model";
import type { PublicUser } from "@/server/models/user.model";
import { verifySessionToken } from "@/server/services/session.service";

/**
 * Usuário autenticado da requisição atual (Server Components / Server Actions).
 * Confere no banco se o usuário ainda existe e está ativo.
 */
export const getCurrentUser = cache(async (): Promise<PublicUser | null> => {
  const store = await cookies();
  const session = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  return authService.getActiveUser(session.userId);
});
