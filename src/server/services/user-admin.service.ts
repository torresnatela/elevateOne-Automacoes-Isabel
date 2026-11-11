import { AppError } from "@/server/lib/errors";
import { normalizePhone, toPublicUser, type PublicUser } from "@/server/models/user.model";
import type { UserRepository } from "@/server/repositories/user.repository";

/** O que o admin gere nos utilizadores (hoje, o número de WhatsApp de cada um). */
export class UserAdminService {
  constructor(private readonly users: UserRepository) {}

  async list(): Promise<PublicUser[]> {
    return (await this.users.list()).map(toPublicUser);
  }

  /** Dá a um utilizador o número de WhatsApp com que fala com os agentes, ou tira-lho (vazio). */
  async setPhone(userId: string, phone: string | null): Promise<string | null> {
    const normalized = phone?.trim() ? normalizePhone(phone) : null;
    if (phone?.trim() && !normalized)
      throw new AppError(
        "Número inválido. Escreva-o com o indicativo do país, por exemplo 351 912 345 678.",
        400,
        "INVALID_PHONE",
      );
    if (normalized) {
      const owner = await this.users.findByPhone(normalized);
      if (owner && owner.id !== userId)
        throw new AppError("Esse número já é de outro utilizador.", 409, "PHONE_TAKEN");
    }
    if (!(await this.users.setPhone(userId, normalized)))
      throw new AppError("Utilizador não encontrado.", 404, "USER_NOT_FOUND");
    return normalized;
  }
}
