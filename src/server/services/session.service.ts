import { SignJWT, jwtVerify } from "jose";
import { ROLES } from "@/server/models/user.model";
import { SESSION_TTL_SECONDS, type Session } from "@/server/models/session.model";

/**
 * Assinatura/validação do token de sessão (JWT HS256).
 * Usa apenas `jose`, portanto roda tanto no Node quanto no middleware (edge).
 */
function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET ausente ou com menos de 32 caracteres");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(
  session: Session,
  { expiresInSeconds = SESSION_TTL_SECONDS }: { expiresInSeconds?: number } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ name: session.name, email: session.email, role: session.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.userId)
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(getSecret());
}

export async function verifySessionToken(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
    const { sub, name, email, role } = payload;
    if (
      typeof sub !== "string" ||
      typeof name !== "string" ||
      typeof email !== "string" ||
      !ROLES.includes(role as Session["role"])
    ) {
      return null;
    }
    return { userId: sub, name, email, role: role as Session["role"] };
  } catch {
    return null;
  }
}
