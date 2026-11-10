/**
 * Prepara o banco de teste para o E2E: usuário padrão (ADMIN) + um usuário comum.
 * Executado via `tsx` (resolve os aliases do tsconfig) pelo global-setup.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaUserRepository } from "@/server/repositories/user.repository";
import { hashPassword } from "@/server/services/password.service";
import { seedDefaultAdmin } from "@/server/services/seed.service";

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "users" RESTART IDENTITY CASCADE');
    const repo = new PrismaUserRepository(prisma);
    await seedDefaultAdmin(repo, {
      name: process.env.DEFAULT_ADMIN_NAME ?? "Administrador",
      email: process.env.DEFAULT_ADMIN_EMAIL ?? "",
      password: process.env.DEFAULT_ADMIN_PASSWORD ?? "",
    });
    await repo.create({
      name: "Usuário Comum",
      email: "user@elevateone.local",
      passwordHash: await hashPassword("User@1234"),
      role: "USER",
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
