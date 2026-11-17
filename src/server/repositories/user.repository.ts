import type { PrismaClient, User as PrismaUser } from "@prisma/client";
import { normalizeEmail, type NewUser, type User } from "@/server/models/user.model";

/** Contrato de persistência de usuários. Services dependem desta interface. */
export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  /** Quem tem este número de WhatsApp (só dígitos). */
  findByPhone(phone: string): Promise<User | null>;
  /** Todos, por nome. */
  list(): Promise<User[]>;
  /** Dá ou tira (`null`) o número de WhatsApp. `false` se o utilizador não existe. */
  setPhone(id: string, phone: string | null): Promise<boolean>;
  /** Troca o hash da senha. `false` se o utilizador não existe. */
  setPasswordHash(id: string, passwordHash: string): Promise<boolean>;
  /** Ativa ou desativa. `false` se o utilizador não existe. */
  setActive(id: string, active: boolean): Promise<boolean>;
  create(data: NewUser): Promise<User>;
  /** Cria o usuário se o e-mail não existir; nunca sobrescreve um existente. */
  upsertByEmail(data: NewUser): Promise<User>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toDomain(row: PrismaUser): User {
  return { ...row };
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string) {
    if (!UUID_RE.test(id)) return null;
    const row = await this.db.user.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByEmail(email: string) {
    const row = await this.db.user.findUnique({ where: { email: normalizeEmail(email) } });
    return row ? toDomain(row) : null;
  }

  async findByPhone(phone: string) {
    const row = await this.db.user.findUnique({ where: { phone } });
    return row ? toDomain(row) : null;
  }

  async list() {
    return (await this.db.user.findMany({ orderBy: { name: "asc" } })).map(toDomain);
  }

  async setPhone(id: string, phone: string | null) {
    if (!UUID_RE.test(id)) return false;
    const { count } = await this.db.user.updateMany({ where: { id }, data: { phone } });
    return count > 0;
  }

  async setPasswordHash(id: string, passwordHash: string) {
    if (!UUID_RE.test(id)) return false;
    const { count } = await this.db.user.updateMany({ where: { id }, data: { passwordHash } });
    return count > 0;
  }

  async setActive(id: string, active: boolean) {
    if (!UUID_RE.test(id)) return false;
    const { count } = await this.db.user.updateMany({ where: { id }, data: { active } });
    return count > 0;
  }

  async create(data: NewUser) {
    const row = await this.db.user.create({
      data: { ...data, email: normalizeEmail(data.email) },
    });
    return toDomain(row);
  }

  async upsertByEmail(data: NewUser) {
    const email = normalizeEmail(data.email);
    const row = await this.db.user.upsert({
      where: { email },
      update: {},
      create: { ...data, email },
    });
    return toDomain(row);
  }
}
