import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@/server/lib/errors";
import { errorResponse, handleError } from "@/server/lib/http";
import { requireSession } from "@/server/lib/session";
import type { ClientMailSyncService } from "@/server/services/client-mail-sync.service";
import { invoicesToCsv, type ClientMailService } from "@/server/services/client-mail.service";
import { invoiceFilterSchema, invoicePatchSchema } from "@/server/validators/invoice.schemas";

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const filterOf = (req: NextRequest) =>
  invoiceFilterSchema.parse(
    Object.fromEntries([...req.nextUrl.searchParams].filter(([, v]) => v !== "")),
  );

/** As faturas e os emails dos clientes, e o agente que os lê. */
export class ClientMailController {
  constructor(
    private readonly mail: ClientMailService,
    private readonly sync: ClientMailSyncService,
    /** O segredo do agendamento (CRON_SECRET); sem ele, a rota do agendamento recusa tudo. */
    private readonly cronSecret: () => string | undefined,
    private readonly defer: (task: () => Promise<void>) => void,
  ) {}

  /** O agendamento da Vercel: corre a sincronização e devolve o relatório. */
  async scheduledSync(req: NextRequest) {
    const secret = this.cronSecret();
    if (!secret) return errorResponse(503, "CRON_NOT_CONFIGURED", "CRON_SECRET não configurado");
    if (!same(req.headers.get("authorization") ?? "", `Bearer ${secret}`))
      return errorResponse(401, "UNAUTHORIZED", "Não autorizado");
    try {
      return NextResponse.json(await this.sync.run());
    } catch (err) {
      return handleError(err);
    }
  }

  /** O botão «Sincronizar agora»: responde logo e corre depois. */
  async syncNow(req: NextRequest) {
    try {
      await requireSession(req);
      this.defer(async () => {
        try {
          await this.sync.run();
        } catch (error) {
          console.error(error);
        }
      });
      return NextResponse.json({ ok: true }, { status: 202 });
    } catch (err) {
      return handleError(err);
    }
  }

  async status(req: NextRequest) {
    try {
      await requireSession(req);
      const [mailboxes, running] = await Promise.all([
        this.mail.mailboxes(),
        this.sync.isRunning(),
      ]);
      return NextResponse.json({ mailboxes, running });
    } catch (err) {
      return handleError(err);
    }
  }

  async listInvoices(req: NextRequest) {
    try {
      await requireSession(req);
      return NextResponse.json({ invoices: await this.mail.listInvoices(filterOf(req)) });
    } catch (err) {
      return handleError(err);
    }
  }

  async exportCsv(req: NextRequest) {
    try {
      await requireSession(req);
      const invoices = await this.mail.listInvoices({ ...filterOf(req), limit: 5000 });
      return new NextResponse(invoicesToCsv(invoices), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="faturas.csv"',
        },
      });
    } catch (err) {
      return handleError(err);
    }
  }

  async updateInvoice(req: NextRequest, id: string) {
    try {
      const session = await requireSession(req);
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        throw new AppError("Corpo da requisição inválido", 400, "INVALID_JSON");
      }
      const patch = invoicePatchSchema.parse(body);
      return NextResponse.json({
        invoice: await this.mail.updateInvoice(id, patch, session.userId),
      });
    } catch (err) {
      return handleError(err);
    }
  }

  async invoiceFile(req: NextRequest, id: string) {
    try {
      await requireSession(req);
      const file = await this.mail.invoiceFile(id);
      return new NextResponse(Buffer.from(file.data), {
        headers: {
          "content-type": file.mimeType,
          "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          "cache-control": "private, no-store",
        },
      });
    } catch (err) {
      return handleError(err);
    }
  }
}
