import { NextResponse, type NextRequest } from "next/server";
import { sessionCookieOptions } from "@/server/lib/cookies";
import { errorResponse, handleError } from "@/server/lib/http";
import { SESSION_COOKIE } from "@/server/models/session.model";
import { UnauthorizedError } from "@/server/policies/authorization";
import type { AuthService } from "@/server/services/auth.service";
import { createSessionToken, verifySessionToken } from "@/server/services/session.service";
import { loginSchema } from "@/server/validators/auth.schemas";

/**
 * Controller de autenticação: traduz HTTP <-> services.
 * Não acessa o banco diretamente.
 */
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  async login(req: NextRequest) {
    try {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return errorResponse(400, "INVALID_JSON", "Corpo da requisição inválido");
      }
      const { email, password } = loginSchema.parse(body);
      const { user, session } = await this.auth.authenticate(email, password);

      const res = NextResponse.json({ user });
      res.cookies.set(SESSION_COOKIE, await createSessionToken(session), sessionCookieOptions());
      return res;
    } catch (err) {
      return handleError(err);
    }
  }

  async logout() {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
    return res;
  }

  async me(req: NextRequest) {
    try {
      const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
      const user = session ? await this.auth.getActiveUser(session.userId) : null;
      if (!user) throw new UnauthorizedError();
      return NextResponse.json({ user });
    } catch (err) {
      return handleError(err);
    }
  }
}
