/**
 * Model de domínio do usuário. Independente do Prisma para que controllers,
 * services e o middleware (edge) não dependam da camada de persistência.
 */
export const ROLES = ["ADMIN", "USER"] as const;
export type Role = (typeof ROLES)[number];

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Dados do usuário seguros para expor fora do servidor (sem hash de senha). */
export type PublicUser = Omit<User, "passwordHash">;

export interface NewUser {
  name: string;
  email: string;
  passwordHash: string;
  role?: Role;
  active?: boolean;
}

export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
