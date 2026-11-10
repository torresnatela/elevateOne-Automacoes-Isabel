import { prisma } from "@/server/lib/db";

/** Limpa as tabelas do banco de teste entre os testes. */
export async function resetDatabase() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "users" RESTART IDENTITY CASCADE');
}

export { prisma };
