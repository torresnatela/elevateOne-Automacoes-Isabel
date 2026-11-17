import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { WhatsappService } from "@/server/channels/whatsapp/whatsapp.service";
import { errorResponse } from "@/server/lib/http";

/** O cabeçalho em que a Evolution API manda o segredo combinado. */
export const WEBHOOK_SECRET_HEADER = "x-webhook-secret";

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * O webhook do WhatsApp. Responde logo (a Evolution não espera pelo agente) e trata
 * a mensagem depois, com o `defer` que a rota lhe dá (`after` do Next).
 */
export class WhatsappController {
  constructor(
    private readonly whatsapp: Pick<WhatsappService, "handle">,
    /** O segredo combinado com a Evolution; sem ele, o webhook recusa tudo. */
    private readonly secret: () => string | undefined,
    private readonly defer: (task: () => Promise<void>) => void,
  ) {}

  async webhook(req: NextRequest) {
    const secret = this.secret();
    if (!secret) return errorResponse(503, "WHATSAPP_NOT_CONFIGURED", "Webhook não configurado");
    if (!same(req.headers.get(WEBHOOK_SECRET_HEADER) ?? "", secret))
      return errorResponse(401, "UNAUTHORIZED", "Não autorizado");

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return errorResponse(400, "INVALID_JSON", "Corpo da requisição inválido");
    }

    this.defer(async () => {
      try {
        await this.whatsapp.handle(payload);
      } catch (error) {
        console.error(error);
      }
    });
    return NextResponse.json({ ok: true });
  }
}
