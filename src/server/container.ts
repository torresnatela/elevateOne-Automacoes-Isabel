import "server-only";
import { after } from "next/server";
import { encryptionKey } from "@/server/lib/crypto";
import { prisma } from "@/server/lib/db";
import { RateLimiter } from "@/server/lib/rate-limiter";
import {
  INTERNAL_ASSISTANT_ID,
  internalAssistant,
} from "@/server/agents/definitions/internal-assistant";
import {
  PERSONAL_ASSISTANT_ID,
  personalAssistant,
} from "@/server/agents/definitions/personal-assistant";
import { searchKnowledgeTool } from "@/server/agents/tools/search-knowledge.tool";
import { googleTools } from "@/server/agents/tools/google.tools";
import { WhatsappService } from "@/server/channels/whatsapp/whatsapp.service";
import { ChatController } from "@/server/controllers/chat.controller";
import { ChatService } from "@/server/services/chat.service";
import { AgentRunner } from "@/server/agents/core/runner";
import { AgentRegistry } from "@/server/agents/registry";
import { AgentSettingsController } from "@/server/controllers/agent-settings.controller";
import { AuthController } from "@/server/controllers/auth.controller";
import { HealthController } from "@/server/controllers/health.controller";
import { OfficeController } from "@/server/controllers/office.controller";
import { UserAdminController } from "@/server/controllers/user-admin.controller";
import { WhatsappController } from "@/server/controllers/whatsapp.controller";
import { GoogleController } from "@/server/controllers/google.controller";
import { MicrosoftController } from "@/server/controllers/microsoft.controller";
import { KnowledgeController } from "@/server/controllers/knowledge.controller";
import { AnthropicFileStore } from "@/server/integrations/anthropic/anthropic-file-store";
import { AnthropicLlmClient } from "@/server/integrations/anthropic/anthropic-llm.client";
import { FileTextExtractor, pdfPageCount } from "@/server/integrations/documents/text-extractor";
import { EvolutionClient } from "@/server/integrations/evolution/evolution.client";
import { GoogleOAuthClient } from "@/server/integrations/google/oauth";
import { MicrosoftOAuthClient } from "@/server/integrations/microsoft/oauth";
import { PrismaAgentEventRepository } from "@/server/repositories/agent-event.repository";
import { PrismaAgentSettingRepository } from "@/server/repositories/agent-setting.repository";
import { PrismaConversationRepository } from "@/server/repositories/conversation.repository";
import { PrismaGoogleAccountRepository } from "@/server/repositories/google-account.repository";
import { PrismaMicrosoftAccountRepository } from "@/server/repositories/microsoft-account.repository";
import { PrismaInboundMessageRepository } from "@/server/repositories/inbound-message.repository";
import { PrismaKnowledgeRepository } from "@/server/repositories/knowledge.repository";
import { PrismaPendingActionRepository } from "@/server/repositories/pending-action.repository";
import { PrismaUserRepository } from "@/server/repositories/user.repository";
import { AgentSettingsService } from "@/server/services/agent-settings.service";
import { AuthService } from "@/server/services/auth.service";
import { GoogleService } from "@/server/services/google.service";
import { MicrosoftService } from "@/server/services/microsoft.service";
import { OfficeService } from "@/server/services/office.service";
import { UserAdminService } from "@/server/services/user-admin.service";
import { KnowledgeService } from "@/server/services/knowledge.service";

/** Composição das dependências (injeção manual). Ponto único para trocar implementações. */
export const userRepository = new PrismaUserRepository(prisma);
export const authService = new AuthService(userRepository);
// 5 senhas erradas em 15 minutos, por endereço e e-mail, travam novas tentativas.
export const authController = new AuthController(authService, new RateLimiter(5, 15 * 60_000));

/** Os agentes: cada automação nova regista aqui as suas ferramentas e o seu agente. */
export const agentRegistry = new AgentRegistry();
export const conversationRepository = new PrismaConversationRepository(prisma);
export const agentEventRepository = new PrismaAgentEventRepository(prisma);
export const llmClient = AnthropicLlmClient.fromEnv();

export const agentSettingsService = new AgentSettingsService(
  agentRegistry,
  new PrismaAgentSettingRepository(prisma),
);
export const agentSettingsController = new AgentSettingsController(agentSettingsService);

export const agentRunner = new AgentRunner({
  registry: agentRegistry,
  llm: llmClient,
  conversations: conversationRepository,
  events: agentEventRepository,
  prompts: agentSettingsService,
  pendingActions: new PrismaPendingActionRepository(prisma),
});

/** A base de conhecimento. */
const textExtractor = new FileTextExtractor();
export const knowledgeService = new KnowledgeService(
  new PrismaKnowledgeRepository(prisma),
  textExtractor,
);
export const knowledgeController = new KnowledgeController(knowledgeService);

/** A página das integrações: os erros de conta por ligar dizem onde se liga, e o agente passa o endereço. */
function integrationsUrl() {
  return process.env.APP_URL ? `${process.env.APP_URL.replace(/\/+$/, "")}/integracoes` : null;
}

/** As contas Google ligadas. */
export const googleService = new GoogleService(
  new PrismaGoogleAccountRepository(prisma),
  GoogleOAuthClient.fromEnv(),
  () => encryptionKey(),
  undefined,
  undefined,
  integrationsUrl,
);
export const googleController = new GoogleController(googleService);

/** As contas Microsoft ligadas (OneDrive) e a pasta da empresa de cada uma. */
export const microsoftService = new MicrosoftService(
  new PrismaMicrosoftAccountRepository(prisma),
  MicrosoftOAuthClient.fromEnv(),
  () => encryptionKey(),
  undefined,
  undefined,
  integrationsUrl,
);
export const microsoftController = new MicrosoftController(microsoftService);

// As automações: ferramentas primeiro, depois os agentes que as usam.
agentRegistry.registerTool(searchKnowledgeTool(knowledgeService));
for (const tool of googleTools(googleService, undefined, textExtractor))
  agentRegistry.registerTool(tool);
agentRegistry.registerAgent(internalAssistant).registerAgent(personalAssistant);

/** O canal do WhatsApp. */
export const whatsappService = new WhatsappService({
  users: userRepository,
  inbound: new PrismaInboundMessageRepository(prisma),
  conversations: conversationRepository,
  runner: agentRunner,
  messenger: EvolutionClient.fromEnv(),
  files: AnthropicFileStore.fromEnv(),
  extractor: textExtractor,
  pdfPages: pdfPageCount,
  agentId: PERSONAL_ASSISTANT_ID,
  log: (message) => console.warn(message),
});
export const whatsappController = new WhatsappController(
  whatsappService,
  () => process.env.WHATSAPP_WEBHOOK_SECRET,
  (task) => after(task),
);

export const userAdminService = new UserAdminService(userRepository);
export const userAdminController = new UserAdminController(userAdminService);

/** O chat interno da equipa. */
export const chatService = new ChatService(
  agentRegistry,
  agentRunner,
  conversationRepository,
  INTERNAL_ASSISTANT_ID,
);
export const chatController = new ChatController(chatService);

/** O que o AI Office lê. */
export const officeService = new OfficeService(agentRegistry, agentEventRepository);
export const officeController = new OfficeController(
  officeService,
  () => process.env.OFFICE_API_TOKEN,
);

export const healthController = new HealthController(() => prisma.$queryRaw`SELECT 1`);
