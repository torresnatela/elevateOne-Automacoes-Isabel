import { NextResponse, type NextRequest } from "next/server";
import { sessionCookieOptions } from "@/server/lib/cookies";
import { errorResponse, handleError } from "@/server/lib/http";
import { SESSION_COOKIE } from "@/server/models/session.model";
import { UnauthorizedError } from "@/server/policies/authorization";
import type { RateLimiter } from "@/server/lib/rate-limiter";
import { InvalidCredentialsError, type AuthService } from "@/server/services/auth.service";
import { createSessionToken, verifySessionToken } from "@/server/services/session.service";
import { changePasswordSchema, loginSchema } from "@/server/validators/auth.schemas";

/** De onde vem o pedido: o primeiro endereço que o proxy (Caddy) registou. */
const clientAddress = (req: NextRequest) =>
  req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "desconhecido";

/**
 * Controller de autenticação: traduz HTTP <-> services.
 * Não acessa o banco diretamente.
 */
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    /** Trava quem erra a senha muitas vezes seguidas (por endereço e e-mail). */
    private readonly limiter?: RateLimiter,
  ) {}

  async login(req: NextRequest) {
    try {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return errorResponse(400, "INVALID_JSON", "Corpo da requisição inválido");
      }
      const { email, password } = loginSchema.parse(body);

      const attempt = `${clientAddress(req)}|${email}`;
      const wait = this.limiter?.retryAfterSeconds(attempt) ?? 0;
      if (wait > 0) {
        const res = errorResponse(
          429,
          "TOO_MANY_ATTEMPTS",
          "Muitas tentativas falhadas. Tente novamente daqui a alguns minutos.",
        );
        res.headers.set("retry-after", String(wait));
        return res;
      }

      let result: Awaited<ReturnType<AuthService["authenticate"]>>;
      try {
        result = await this.auth.authenticate(email, password);
      } catch (err) {
        if (err instanceof InvalidCredentialsError) this.limiter?.fail(attempt);
        throw err;
      }
      this.limiter?.reset(attempt);
      const { user, session } = result;

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

  /** Troca a senha de quem está autenticado. */
  async changePassword(req: NextRequest) {
    try {
      const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
      if (!session) throw new UnauthorizedError();
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return errorResponse(400, "INVALID_JSON", "Corpo da requisição inválido");
      }
      const { currentPassword, newPassword } = changePasswordSchema.parse(body);
      await this.auth.changePassword(session.userId, currentPassword, newPassword);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return handleError(err);
    }
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
