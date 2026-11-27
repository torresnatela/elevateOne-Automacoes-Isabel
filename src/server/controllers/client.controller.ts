import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@/server/lib/errors";
import { handleError } from "@/server/lib/http";
import { requireSession } from "@/server/lib/session";
import type { ClientService } from "@/server/services/client.service";
import { clientActiveSchema, clientSchema } from "@/server/validators/client.schemas";

async function bodyOf(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError("Corpo da requisição inválido", 400, "INVALID_JSON");
  }
}

/** Controller do cadastro de clientes: qualquer utilizador consulta e edita; só o admin desativa. */
export class ClientController {
  constructor(private readonly clients: ClientService) {}

  async list(req: NextRequest) {
    try {
      await requireSession(req);
      const params = req.nextUrl.searchParams;
      const clients = await this.clients.list({
        query: params.get("q") ?? undefined,
        includeInactive: params.get("inactive") === "1",
      });
      return NextResponse.json({ clients });
    } catch (err) {
      return handleError(err);
    }
  }

  async get(req: NextRequest, id: string) {
    try {
      await requireSession(req);
      return NextResponse.json({ client: await this.clients.get(id) });
    } catch (err) {
      return handleError(err);
    }
  }

  async create(req: NextRequest) {
    try {
      await requireSession(req);
      const data = clientSchema.parse(await bodyOf(req));
      return NextResponse.json({ client: await this.clients.create(data) }, { status: 201 });
    } catch (err) {
      return handleError(err);
    }
  }

  async update(req: NextRequest, id: string) {
    try {
      await requireSession(req);
      const data = clientSchema.parse(await bodyOf(req));
      return NextResponse.json({ client: await this.clients.update(id, data) });
    } catch (err) {
      return handleError(err);
    }
  }

  async setActive(req: NextRequest, id: string) {
    try {
      await requireSession(req, "ADMIN");
      const { active } = clientActiveSchema.parse(await bodyOf(req));
      await this.clients.setActive(id, active);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return handleError(err);
    }
  }
}
