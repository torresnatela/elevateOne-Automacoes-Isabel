import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  Channel,
  ContentBlock,
  Conversation,
  Message,
  MessageRole,
  NewConversation,
} from "@/server/models/conversation.model";

/** Contrato de persistência das conversas e das suas mensagens. */
export interface ConversationRepository {
  create(data: NewConversation): Promise<Conversation>;
  findById(id: string): Promise<Conversation | null>;
  /** As conversas de um utilizador com um agente, da mais recente para a mais antiga. */
  listByUser(agentId: string, userId: string): Promise<Conversation[]>;
  /** A conversa mais recente de alguém de fora (um número) com um agente, num canal. */
  findLatestExternal(
    agentId: string,
    channel: Channel,
    externalId: string,
  ): Promise<Conversation | null>;
  setTitle(id: string, title: string): Promise<void>;
  /** Apaga a conversa e as mensagens. `false` se não existia. */
  delete(id: string): Promise<boolean>;
  addMessage(conversationId: string, role: MessageRole, content: ContentBlock[]): Promise<Message>;
  /** As mensagens da conversa, da mais antiga para a mais recente. */
  listMessages(conversationId: string): Promise<Message[]>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MessageRow = Prisma.MessageGetPayload<object>;

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    content: row.content as unknown as ContentBlock[],
    createdAt: row.createdAt,
  };
}

export class PrismaConversationRepository implements ConversationRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(data: NewConversation) {
    return this.db.conversation.create({
      data: {
        agentId: data.agentId,
        channel: data.channel,
        userId: data.userId ?? null,
        externalId: data.externalId ?? null,
      },
    });
  }

  async findById(id: string) {
    if (!UUID_RE.test(id)) return null;
    return this.db.conversation.findUnique({ where: { id } });
  }

  async listByUser(agentId: string, userId: string) {
    if (!UUID_RE.test(userId)) return [];
    return this.db.conversation.findMany({
      where: { agentId, userId },
      orderBy: { updatedAt: "desc" },
    });
  }

  async findLatestExternal(agentId: string, channel: Channel, externalId: string) {
    return this.db.conversation.findFirst({
      where: { agentId, channel, externalId },
      orderBy: { updatedAt: "desc" },
    });
  }

  async setTitle(id: string, title: string) {
    await this.db.conversation.update({ where: { id }, data: { title } });
  }

  async delete(id: string) {
    if (!UUID_RE.test(id)) return false;
    const { count } = await this.db.conversation.deleteMany({ where: { id } });
    return count > 0;
  }

  async addMessage(conversationId: string, role: MessageRole, content: ContentBlock[]) {
    const [row] = await this.db.$transaction([
      this.db.message.create({
        data: { conversationId, role, content: content as unknown as Prisma.InputJsonValue },
      }),
      this.db.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      }),
    ]);
    return toMessage(row);
  }

  async listMessages(conversationId: string) {
    if (!UUID_RE.test(conversationId)) return [];
    const rows = await this.db.message.findMany({
      where: { conversationId },
      orderBy: { seq: "asc" },
    });
    return rows.map(toMessage);
  }
}
