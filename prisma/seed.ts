import { PrismaClient } from "@prisma/client";
import { PrismaUserRepository } from "../src/server/repositories/user.repository";
import { seedDefaultAdmin } from "../src/server/services/seed.service";

const prisma = new PrismaClient();

async function main() {
  const user = await seedDefaultAdmin(new PrismaUserRepository(prisma), {
    name: process.env.DEFAULT_ADMIN_NAME ?? "Administrador",
    email: process.env.DEFAULT_ADMIN_EMAIL ?? "",
    password: process.env.DEFAULT_ADMIN_PASSWORD ?? "",
  });
  console.log(`Usuário padrão pronto: ${user.email} (${user.role})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
