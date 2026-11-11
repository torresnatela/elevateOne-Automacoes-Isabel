import type { AgentRunner, RunInput } from "@/server/agents/core/runner";
import type { AgentRegistry } from "@/server/agents/registry";
import { AppError } from "@/server/lib/errors";
import { textOf, type Conversation, type MessageRole } from "@/server/models/conversation.model";
import type { ConversationRepository } from "@/server/repositories/conversation.repository";

/** Uma mensagem como o chat a mostra: só o texto, sem os passos das ferramentas. */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  createdAt: Date;
}

export interface ChatConversation {
  id: string;
  title: string;
  updatedAt: Date;
}

const TITLE_LENGTH = 60;
const UNTITLED = "Nova conversa";

class ConversationNotFoundError extends AppError {
  constructor() {
    super("Conversa não encontrada.", 404, "CONVERSATION_NOT_FOUND");
  }
}

const toView = (c: Conversation): ChatConversation => ({
  id: c.id,
  title: c.title ?? UNTITLED,
  updatedAt: c.updatedAt,
});

/** O chat de um agente no site: cada utilizador vê e continua só as suas conversas. */
export class ChatService {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly runner: Pick<AgentRunner, "run">,
    private readonly conversations: ConversationRepository,
    /** O agente deste chat. */
    private readonly agentId: string,
  ) {}

  async list(userId: string): Promise<ChatConversation[]> {
    return (await this.conversations.listByUser(this.agentId, userId)).map(toView);
  }

  async start(userId: string): Promise<ChatConversation> {
    const agent = this.registry.getAgent(this.agentId);
    if (!agent.channels.includes("WEB"))
      throw new AppError("Este agente não está disponível no chat.", 400, "CHANNEL_NOT_ALLOWED");
    return toView(await this.conversations.create({ agentId: agent.id, channel: "WEB", userId }));
  }

  async messages(conversationId: string, userId: string): Promise<ChatMessage[]> {
    await this.own(conversationId, userId);
    const messages = await this.conversations.listMessages(conversationId);
    return messages
      .map((m) => ({ id: m.id, role: m.role, text: textOf(m.content), createdAt: m.createdAt }))
      .filter((m) => m.text !== "");
  }

  async remove(conversationId: string, userId: string): Promise<void> {
    await this.own(conversationId, userId);
    await this.conversations.delete(conversationId);
  }

  /** Confere que a conversa é do utilizador antes de começar a responder (para o erro sair como HTTP). */
  async prepare(conversationId: string, userId: string): Promise<void> {
    await this.own(conversationId, userId);
  }

  /** Responde a uma mensagem. A conversa ganha o título da primeira. */
  async send(
    conversationId: string,
    userId: string,
    text: string,
    hooks: Pick<RunInput, "onText" | "onTool"> = {},
  ): Promise<{ text: string }> {
    const conversation = await this.own(conversationId, userId);
    if (!conversation.title) {
      const clean = text.replace(/\s+/g, " ").trim();
      await this.conversations.setTitle(
        conversation.id,
        clean.length > TITLE_LENGTH ? `${clean.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : clean,
      );
    }
    return this.runner.run({ conversationId, text, ...hooks });
  }

  /** Uma conversa de outra pessoa responde como se não existisse. */
  private async own(conversationId: string, userId: string): Promise<Conversation> {
    const conversation = await this.conversations.findById(conversationId);
    if (!conversation || conversation.userId !== userId || conversation.agentId !== this.agentId)
      throw new ConversationNotFoundError();
    return conversation;
  }
}
