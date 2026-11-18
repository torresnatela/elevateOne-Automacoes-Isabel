import { randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@/server/lib/errors";
import { handleError } from "@/server/lib/http";
import { requireSession } from "@/server/lib/session";
import type { GoogleService } from "@/server/services/google.service";

/** O cookie que guarda o `state` entre o pedido de autorização e o retorno do Google. */
export const GOOGLE_STATE_COOKIE = "eo_google_state";
const STATE_TTL_SECONDS = 600;

/** Onde a pessoa volta no fim, com o resultado no endereço. */
const RESULT_PATH = "/integracoes";

const sameState = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Controller da ligação ao Google: o vaivém do OAuth, o estado e o desligar. */
export class GoogleController {
  constructor(private readonly google: GoogleService) {}

  /**
   * De volta às integrações, por um endereço relativo: atrás de um proxy (o Caddy, um túnel)
   * o servidor vê o seu endereço interno, e mandava a pessoa para lá. O navegador resolve-o
   * contra o endereço em que está.
   */
  private back(result: string) {
    const res = new NextResponse(null, {
      status: 307,
      headers: { location: `${RESULT_PATH}?google=${encodeURIComponent(result)}` },
    });
    res.cookies.set(GOOGLE_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  /** Manda a pessoa ao Google autorizar. O `state` fica num cookie para se conferir no retorno. */
  async connect(req: NextRequest) {
    try {
      await requireSession(req);
      const state = randomBytes(24).toString("base64url");
      const res = NextResponse.redirect(this.google.authUrl(state));
      res.cookies.set(GOOGLE_STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: STATE_TTL_SECONDS,
      });
      return res;
    } catch (err) {
      if (err instanceof AppError && err.code === "GOOGLE_NOT_CONFIGURED")
        return this.back("por-configurar");
      return handleError(err);
    }
  }

  /** O retorno do Google: confere o `state`, troca o código e guarda a conta. */
  async callback(req: NextRequest) {
    try {
      const session = await requireSession(req);
      const params = req.nextUrl.searchParams;
      if (params.get("error")) return this.back("recusado");

      const state = params.get("state") ?? "";
      const expected = req.cookies.get(GOOGLE_STATE_COOKIE)?.value ?? "";
      const code = params.get("code");
      if (!code || !expected || !sameState(state, expected)) return this.back("erro");

      await this.google.connect(session.userId, code);
      return this.back("ligado");
    } catch (err) {
      if (err instanceof AppError && (err.status === 401 || err.status === 403))
        return handleError(err);
      if (!(err instanceof AppError)) console.error(err);
      return this.back("erro");
    }
  }

  async status(req: NextRequest) {
    try {
      const session = await requireSession(req);
      return NextResponse.json({ google: await this.google.status(session.userId) });
    } catch (err) {
      return handleError(err);
    }
  }

  async disconnect(req: NextRequest) {
    try {
      const session = await requireSession(req);
      await this.google.disconnect(session.userId);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return handleError(err);
    }
  }
}
