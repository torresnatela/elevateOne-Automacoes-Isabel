import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AppError } from "@/server/lib/errors";
import { handleError } from "@/server/lib/http";
import { requireSession } from "@/server/lib/session";
import type { UserAdminService } from "@/server/services/user-admin.service";
import {
  createUserSchema,
  resetPasswordSchema,
  setActiveSchema,
} from "@/server/validators/auth.schemas";

/** O corpo em JSON; um corpo que não é JSON sai como erro 400. */
async function bodyOf(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError("Corpo da requisição inválido", 400, "INVALID_JSON");
  }
}

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

  async create(req: NextRequest) {
    try {
      await requireSession(req, "ADMIN");
      const data = createUserSchema.parse(await bodyOf(req));
      return NextResponse.json({ user: await this.users.create(data) }, { status: 201 });
    } catch (err) {
      return handleError(err);
    }
  }

  async setActive(req: NextRequest, userId: string) {
    try {
      const session = await requireSession(req, "ADMIN");
      const { active } = setActiveSchema.parse(await bodyOf(req));
      await this.users.setActive(userId, active, session.userId);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return handleError(err);
    }
  }

  async resetPassword(req: NextRequest, userId: string) {
    try {
      await requireSession(req, "ADMIN");
      const { password } = resetPasswordSchema.parse(await bodyOf(req));
      await this.users.resetPassword(userId, password);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return handleError(err);
    }
  }

  async setPhone(req: NextRequest, userId: string) {
    try {
      await requireSession(req, "ADMIN");
      const { phone } = phoneSchema.parse(await bodyOf(req));
      return NextResponse.json({ phone: await this.users.setPhone(userId, phone) });
    } catch (err) {
      return handleError(err);
    }
  }
}
