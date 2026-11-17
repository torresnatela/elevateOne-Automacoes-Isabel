import { AppError } from "@/server/lib/errors";
import {
  normalizePhone,
  toPublicUser,
  type PublicUser,
  type Role,
} from "@/server/models/user.model";
import type { UserRepository } from "@/server/repositories/user.repository";
import { hashPassword } from "./password.service";

const notFound = () => new AppError("Utilizador não encontrado.", 404, "USER_NOT_FOUND");

/** O que o admin gere nos utilizadores: criar, ativar e desativar, repor a senha e o número de WhatsApp. */
export class UserAdminService {
  constructor(private readonly users: UserRepository) {}

  async list(): Promise<PublicUser[]> {
    return (await this.users.list()).map(toPublicUser);
  }

  async create(data: {
    name: string;
    email: string;
    password: string;
    role: Role;
  }): Promise<PublicUser> {
    if (await this.users.findByEmail(data.email))
      throw new AppError("Já existe um utilizador com esse e-mail.", 409, "EMAIL_TAKEN");
    const user = await this.users.create({
      name: data.name,
      email: data.email,
      passwordHash: await hashPassword(data.password),
      role: data.role,
    });
    return toPublicUser(user);
  }

  /** Ativa ou desativa um utilizador. Ninguém se desativa a si próprio (ficava sem forma de voltar). */
  async setActive(userId: string, active: boolean, actingUserId: string): Promise<void> {
    if (!active && userId === actingUserId)
      throw new AppError("Não pode desativar a sua própria conta.", 400, "CANNOT_DEACTIVATE_SELF");
    if (!(await this.users.setActive(userId, active))) throw notFound();
  }

  /** Dá uma senha nova a um utilizador que perdeu a sua. */
  async resetPassword(userId: string, password: string): Promise<void> {
    if (!(await this.users.setPasswordHash(userId, await hashPassword(password)))) throw notFound();
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
    if (!(await this.users.setPhone(userId, normalized))) throw notFound();
    return normalized;
  }
}
