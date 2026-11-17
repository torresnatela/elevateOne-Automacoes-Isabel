import { prisma } from "@/server/lib/db";

/** Limpa as tabelas do banco de teste entre os testes. */
export async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "users", "conversations", "messages", "agent_events", "knowledge_documents", "knowledge_chunks", "agent_settings", "google_accounts", "pending_actions", "inbound_messages" RESTART IDENTITY CASCADE',
  );
}

export { prisma };
