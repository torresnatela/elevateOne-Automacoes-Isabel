import { randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AppError } from "@/server/lib/errors";
import { handleError } from "@/server/lib/http";
import { requireSession } from "@/server/lib/session";
import type { MicrosoftService } from "@/server/services/microsoft.service";

/** O cookie que guarda o `state` entre o pedido de autorização e o retorno da Microsoft. */
export const MICROSOFT_STATE_COOKIE = "eo_microsoft_state";
const STATE_TTL_SECONDS = 600;
const RESULT_PATH = "/integracoes";

const folderSchema = z.object({ link: z.string().trim().min(1).max(2000) });

const sameState = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Controller da ligação à Microsoft (OneDrive): o vaivém do OAuth, a pasta e o desligar. */
export class MicrosoftController {
  constructor(private readonly microsoft: MicrosoftService) {}

  /** De volta às integrações por um endereço relativo (atrás de um proxy, o servidor não sabe o seu). */
  private back(result: string) {
    const res = new NextResponse(null, {
      status: 307,
      headers: { location: `${RESULT_PATH}?microsoft=${encodeURIComponent(result)}` },
    });
    res.cookies.set(MICROSOFT_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  async connect(req: NextRequest) {
    try {
      await requireSession(req);
      const state = randomBytes(24).toString("base64url");
      const res = NextResponse.redirect(this.microsoft.authUrl(state));
      res.cookies.set(MICROSOFT_STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: STATE_TTL_SECONDS,
      });
      return res;
    } catch (err) {
      if (err instanceof AppError && err.code === "MICROSOFT_NOT_CONFIGURED")
        return this.back("por-configurar");
      return handleError(err);
    }
  }

  async callback(req: NextRequest) {
    try {
      const session = await requireSession(req);
      const params = req.nextUrl.searchParams;
      const error = params.get("error");
      if (error) {
        // Numa conta de empresa, «precisa de aprovação do administrador» chega como erro aqui.
        const description = params.get("error_description") ?? "";
        if (/AADSTS65001|AADSTS90094|admin/i.test(description)) return this.back("precisa-admin");
        return this.back("recusado");
      }

      const state = params.get("state") ?? "";
      const expected = req.cookies.get(MICROSOFT_STATE_COOKIE)?.value ?? "";
      const code = params.get("code");
      if (!code || !expected || !sameState(state, expected)) return this.back("erro");

      await this.microsoft.connect(session.userId, code);
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
      return NextResponse.json({ microsoft: await this.microsoft.status(session.userId) });
    } catch (err) {
      return handleError(err);
    }
  }

  async disconnect(req: NextRequest) {
    try {
      const session = await requireSession(req);
      await this.microsoft.disconnect(session.userId);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return handleError(err);
    }
  }

  /** O que está na pasta da empresa. */
  async folderItems(req: NextRequest) {
    try {
      const session = await requireSession(req);
      return NextResponse.json({ items: await this.microsoft.folderItems(session.userId) });
    } catch (err) {
      return handleError(err);
    }
  }

  /** Escolhe a pasta da empresa, por link de partilha ou caminho no OneDrive. */
  async setFolder(req: NextRequest) {
    try {
      const session = await requireSession(req);
      const { link } = folderSchema.parse(await req.json().catch(() => ({})));
      return NextResponse.json(await this.microsoft.setFolder(session.userId, link));
    } catch (err) {
      return handleError(err);
    }
  }

  async clearFolder(req: NextRequest) {
    try {
      const session = await requireSession(req);
      await this.microsoft.clearFolder(session.userId);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return handleError(err);
    }
  }
}
