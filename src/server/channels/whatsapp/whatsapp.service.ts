import type { AgentRunner } from "@/server/agents/core/runner";
import type { WhatsappMessenger } from "@/server/integrations/evolution/evolution.client";
import type { Transcriber } from "@/server/integrations/openai/openai-transcriber";
import { KeyedQueue } from "@/server/lib/keyed-queue";
import { describeDateTime } from "@/server/lib/time";
import type { ConversationRepository } from "@/server/repositories/conversation.repository";
import type { InboundMessageRepository } from "@/server/repositories/inbound-message.repository";
import type { UserRepository } from "@/server/repositories/user.repository";
import { parseEvolutionWebhook, type IncomingWhatsapp } from "./incoming";

/** Depois de tanto tempo sem mensagens, começa uma conversa nova (o agente não arrasta o dia anterior). */
export const CONVERSATION_GAP_MS = 6 * 60 * 60_000;

export const REPLIES = {
  unsupported: "Só consigo ler mensagens de texto e de voz.",
  emptyAudio: "Não consegui perceber o áudio. Pode repetir ou escrever?",
  failed: "Não consegui tratar do pedido agora. Tente de novo daqui a pouco.",
};

export interface WhatsappServiceDeps {
  users: UserRepository;
  inbound: InboundMessageRepository;
  conversations: ConversationRepository;
  runner: Pick<AgentRunner, "run">;
  messenger: WhatsappMessenger;
  transcriber: Transcriber;
  /** O agente que atende no WhatsApp. */
  agentId: string;
  now?: () => Date;
  log?: (message: string) => void;
}

export type HandleOutcome = "ignored" | "duplicate" | "unauthorized" | "replied" | "failed";

/**
 * O canal do WhatsApp: recebe o que a Evolution API manda, confere quem é, passa o
 * áudio a texto, entrega ao agente e envia a resposta. Só fala com os números de
 * utilizadores ativos; aos outros não responde.
 */
export class WhatsappService {
  private readonly queue = new KeyedQueue();
  private readonly now: () => Date;

  constructor(private readonly deps: WhatsappServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async handle(payload: unknown): Promise<HandleOutcome> {
    const incoming = parseEvolutionWebhook(payload);
    if (!incoming) return "ignored";
    if (!(await this.deps.inbound.claim(incoming.id))) return "duplicate";

    const user = await this.deps.users.findByPhone(incoming.phone);
    if (!user || !user.active) {
      // Sem resposta: um desconhecido não fica a saber que há aqui um agente.
      this.deps.log?.(
        `WhatsApp: mensagem de um número não autorizado (…${incoming.phone.slice(-4)})`,
      );
      return "unauthorized";
    }
    // Uma mensagem de cada vez por pessoa: duas respostas a correr ao mesmo tempo baralhavam a conversa.
    return this.queue.run(incoming.phone, () => this.answer(incoming, user.id));
  }

  private async answer(incoming: IncomingWhatsapp, userId: string): Promise<HandleOutcome> {
    const { messenger, runner } = this.deps;
    try {
      if (incoming.kind === "other") {
        await messenger.sendText(incoming.phone, REPLIES.unsupported);
        return "replied";
      }
      const text = incoming.kind === "audio" ? await this.heard(incoming) : incoming.text!;
      if (!text) {
        await messenger.sendText(incoming.phone, REPLIES.emptyAudio);
        return "replied";
      }

      const conversationId = await this.conversationFor(incoming.phone, userId);
      const result = await runner.run({
        conversationId,
        text,
        context:
          `[Agora: ${describeDateTime(this.now())}, hora de Lisboa. ` +
          `Mensagem recebida por WhatsApp${incoming.kind === "audio" ? ", transcrita de um áudio: pode ter erros em nomes e números" : ""}.]`,
      });
      await messenger.sendText(incoming.phone, result.text);
      return "replied";
    } catch (error) {
      this.deps.log?.(
        `WhatsApp: falhou ao responder: ${error instanceof Error ? error.message : error}`,
      );
      await messenger.sendText(incoming.phone, REPLIES.failed).catch(() => undefined);
      return "failed";
    }
  }

  /** O que foi dito num áudio. */
  private async heard(incoming: IncomingWhatsapp): Promise<string> {
    const audio = incoming.audio
      ? {
          data: new Uint8Array(Buffer.from(incoming.audio.base64, "base64")),
          mimeType: incoming.audio.mimeType,
        }
      : await this.deps.messenger.downloadAudio(incoming.raw);
    return this.deps.transcriber.transcribe(audio);
  }

  /** A conversa em curso com este número, ou uma nova se a última já foi há muito. */
  private async conversationFor(phone: string, userId: string): Promise<string> {
    const { conversations, agentId } = this.deps;
    const latest = await conversations.findLatestExternal(agentId, "WHATSAPP", phone);
    if (
      latest &&
      latest.userId === userId &&
      this.now().getTime() - latest.updatedAt.getTime() < CONVERSATION_GAP_MS
    )
      return latest.id;
    const created = await conversations.create({
      agentId,
      channel: "WHATSAPP",
      userId,
      externalId: phone,
    });
    return created.id;
  }
}
