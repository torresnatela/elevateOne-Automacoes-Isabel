import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, handleError } from "@/server/lib/http";
import type { OfficeService } from "@/server/services/office.service";

const querySchema = z.object({
  /** O n.º do último evento já recebido. */
  desde: z.coerce.number().int().min(0).default(0),
  limite: z.coerce.number().int().min(1).max(500).default(200),
  /** Só eventos a partir deste instante (ISO 8601): o início do dia, ao abrir o escritório. */
  apos: z.string().datetime({ offset: true }).optional(),
});

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** A API que o AI Office lê: `GET /api/office/eventos`, com `Authorization: Bearer <token>`. */
export class OfficeController {
  constructor(
    private readonly office: OfficeService,
    /** O token combinado com o AI Office; sem ele, a API recusa tudo. */
    private readonly token: () => string | undefined,
  ) {}

  async events(req: NextRequest) {
    try {
      const token = this.token();
      if (!token) return errorResponse(503, "OFFICE_NOT_CONFIGURED", "API não configurada");
      const given = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
      if (!same(given, token)) return errorResponse(401, "UNAUTHORIZED", "Não autorizado");

      const { desde, limite, apos } = querySchema.parse(
        Object.fromEntries(req.nextUrl.searchParams),
      );
      const feed = await this.office.feed(desde, limite, apos ? new Date(apos) : undefined);
      return NextResponse.json(feed, { headers: { "cache-control": "no-store" } });
    } catch (err) {
      return handleError(err);
    }
  }
}
