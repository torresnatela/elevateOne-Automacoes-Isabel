import { z } from "zod";
import type { User } from "@/server/models/user.model";
import type { UserRepository } from "@/server/repositories/user.repository";
import { hashPassword } from "./password.service";

export const defaultAdminSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "A senha do usuário padrão precisa ter ao menos 8 caracteres"),
});

export type DefaultAdminConfig = z.input<typeof defaultAdminSchema>;

/** Garante a existência do usuário administrador padrão. Idempotente. */
export async function seedDefaultAdmin(users: UserRepository, config: DefaultAdminConfig): Promise<User> {
  const { name, email, password } = defaultAdminSchema.parse(config);
  const existing = await users.findByEmail(email);
  if (existing) return existing;
  return users.upsertByEmail({ name, email, passwordHash: await hashPassword(password), role: "ADMIN" });
}
