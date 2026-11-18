import { randomUUID } from "node:crypto";
import type { AgentEvent, NewAgentEvent } from "@/server/models/agent-event.model";
import type {
  Channel,
  ContentBlock,
  Conversation,
  Message,
  MessageRole,
  NewConversation,
} from "@/server/models/conversation.model";
import type {
  NewPendingAction,
  PendingAction,
  PendingActionStatus,
} from "@/server/models/pending-action.model";
import type { AgentEventRepository } from "@/server/repositories/agent-event.repository";
import type { ConversationRepository } from "@/server/repositories/conversation.repository";
import type { PendingActionRepository } from "@/server/repositories/pending-action.repository";

/** Conversas em memória, para os testes unitários. */
export class FakeConversationRepository implements ConversationRepository {
  conversations: Conversation[] = [];
  messages: Message[] = [];
  private last = 0;

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** A hora de agora, sempre depois da anterior: a ordem do que acontece nunca empata. */
  private stamp(): Date {
    this.last = Math.max(this.now().getTime(), this.last + 1);
    return new Date(this.last);
  }

  async create(data: NewConversation) {
    const now = this.stamp();
    const conversation: Conversation = {
      id: randomUUID(),
      agentId: data.agentId,
      channel: data.channel,
      userId: data.userId ?? null,
      externalId: data.externalId ?? null,
      title: null,
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.push(conversation);
    return conversation;
  }

  async findById(id: string) {
    return this.conversations.find((c) => c.id === id) ?? null;
  }

  async listByUser(agentId: string, userId: string) {
    return this.conversations
      .filter((c) => c.agentId === agentId && c.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async findLatestExternal(agentId: string, channel: Channel, externalId: string) {
    return (
      this.conversations
        .filter(
          (c) => c.agentId === agentId && c.channel === channel && c.externalId === externalId,
        )
        .sort(
          (a, b) =>
            b.updatedAt.getTime() - a.updatedAt.getTime() ||
            b.createdAt.getTime() - a.createdAt.getTime(),
        )[0] ?? null
    );
  }

  async setTitle(id: string, title: string) {
    const conversation = this.conversations.find((c) => c.id === id);
    if (conversation) conversation.title = title;
  }

  async delete(id: string) {
    const before = this.conversations.length;
    this.conversations = this.conversations.filter((c) => c.id !== id);
    this.messages = this.messages.filter((m) => m.conversationId !== id);
    return this.conversations.length < before;
  }

  async addMessage(conversationId: string, role: MessageRole, content: ContentBlock[]) {
    const message: Message = {
      id: randomUUID(),
      conversationId,
      role,
      content: structuredClone(content),
      createdAt: new Date(),
    };
    this.messages.push(message);
    const conversation = this.conversations.find((c) => c.id === conversationId);
    if (conversation) conversation.updatedAt = this.stamp();
    return message;
  }

  async listMessages(conversationId: string) {
    return this.messages.filter((m) => m.conversationId === conversationId);
  }
}

/** Eventos em memória, para os testes unitários. */
export class FakeAgentEventRepository implements AgentEventRepository {
  events: AgentEvent[] = [];

  async create(data: NewAgentEvent) {
    const event: AgentEvent = {
      id: randomUUID(),
      seq: this.events.length + 1,
      agent: data.agent,
      state: data.state,
      type: data.type ?? null,
      text: data.text,
      tool: data.tool ?? null,
      minutes: data.minutes ?? 0,
      createdAt: new Date(),
    };
    this.events.push(event);
    return event;
  }

  async listAfter(afterSeq: number, limit: number, since?: Date) {
    return this.events
      .filter((e) => e.seq > afterSeq && (!since || e.createdAt >= since))
      .slice(0, limit);
  }
}

/** Ações pendentes em memória. */
export class FakePendingActionRepository implements PendingActionRepository {
  actions: PendingAction[] = [];

  async create(data: NewPendingAction) {
    const action: PendingAction = {
      ...data,
      input: structuredClone(data.input),
      id: randomUUID(),
      status: "PENDING",
      createdAt: new Date(),
    };
    this.actions.push(action);
    return action;
  }

  async findById(id: string) {
    return this.actions.find((a) => a.id === id) ?? null;
  }

  async resolve(id: string, status: Exclude<PendingActionStatus, "PENDING">) {
    const action = this.actions.find((a) => a.id === id);
    if (!action || action.status !== "PENDING") return false;
    action.status = status;
    return true;
  }

  async cancelAllOf(conversationId: string) {
    for (const action of this.actions)
      if (action.conversationId === conversationId && action.status === "PENDING")
        action.status = "CANCELLED";
  }

  async setStatus(id: string, status: PendingActionStatus) {
    const action = this.actions.find((a) => a.id === id);
    if (action) action.status = status;
  }
}
