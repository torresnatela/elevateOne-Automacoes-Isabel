import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, handleError } from "@/server/lib/http";
import { requireSession } from "@/server/lib/session";
import type { UserAdminService } from "@/server/services/user-admin.service";

const phoneSchema = z.object({ phone: z.string().max(40).nullable() });

/** Controller da gestão de utilizadores (só ADMIN). */
export class UserAdminController {
  constructor(private readonly users: UserAdminService) {}

  async list(req: NextRequest) {
    try {
      await requireSession(req, "ADMIN");
      return NextResponse.json({ users: await this.users.list() });
    } catch (err) {
      return handleError(err);
    }
  }

  async setPhone(req: NextRequest, userId: string) {
    try {
      await requireSession(req, "ADMIN");
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return errorResponse(400, "INVALID_JSON", "Corpo da requisição inválido");
      }
      const { phone } = phoneSchema.parse(body);
      return NextResponse.json({ phone: await this.users.setPhone(userId, phone) });
    } catch (err) {
      return handleError(err);
    }
  }
}
