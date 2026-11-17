import { randomUUID } from "node:crypto";
import type { NewUser, User } from "@/server/models/user.model";
import { normalizeEmail } from "@/server/models/user.model";
import type { UserRepository } from "@/server/repositories/user.repository";

/** Repositório em memória para testes unitários de services/controllers. */
export class FakeUserRepository implements UserRepository {
  users: User[] = [];

  async findById(id: string) {
    return this.users.find((u) => u.id === id) ?? null;
  }

  async findByEmail(email: string) {
    return this.users.find((u) => u.email === normalizeEmail(email)) ?? null;
  }

  async findByPhone(phone: string) {
    return this.users.find((u) => u.phone === phone) ?? null;
  }

  async list() {
    return [...this.users].sort((a, b) => a.name.localeCompare(b.name));
  }

  async setPhone(id: string, phone: string | null) {
    const user = this.users.find((u) => u.id === id);
    if (!user) return false;
    user.phone = phone;
    return true;
  }

  async setPasswordHash(id: string, passwordHash: string) {
    const user = this.users.find((u) => u.id === id);
    if (!user) return false;
    user.passwordHash = passwordHash;
    return true;
  }

  async setActive(id: string, active: boolean) {
    const user = this.users.find((u) => u.id === id);
    if (!user) return false;
    user.active = active;
    return true;
  }

  async create(data: NewUser) {
    const now = new Date();
    const user: User = {
      id: randomUUID(),
      name: data.name,
      email: normalizeEmail(data.email),
      passwordHash: data.passwordHash,
      phone: null,
      role: data.role ?? "USER",
      active: data.active ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.users.push(user);
    return user;
  }

  async upsertByEmail(data: NewUser) {
    const existing = await this.findByEmail(data.email);
    if (existing) return existing;
    return this.create(data);
  }
}
