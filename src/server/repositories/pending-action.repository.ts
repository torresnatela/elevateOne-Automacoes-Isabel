import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  NewPendingAction,
  PendingAction,
  PendingActionStatus,
} from "@/server/models/pending-action.model";

/** Contrato de persistência das ações à espera de confirmação. */
export interface PendingActionRepository {
  create(data: NewPendingAction): Promise<PendingAction>;
  findById(id: string): Promise<PendingAction | null>;
  /**
   * Passa a ação de PENDING para outro estado. `false` se já não estava PENDING:
   * quem chega segundo não a leva (uma ação nunca corre duas vezes).
   */
  resolve(id: string, status: Exclude<PendingActionStatus, "PENDING">): Promise<boolean>;
  /** Desiste de todas as que ainda esperam numa conversa (uma proposta nova substitui as anteriores). */
  cancelAllOf(conversationId: string): Promise<void>;
  /** Muda o estado de uma ação já resolvida (uma confirmada que falhou ao correr). */
  setStatus(id: string, status: PendingActionStatus): Promise<void>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PrismaPendingActionRepository implements PendingActionRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(data: NewPendingAction) {
    return this.db.pendingAction.create({
      data: { ...data, input: data.input as Prisma.InputJsonValue },
    });
  }

  async findById(id: string) {
    if (!UUID_RE.test(id)) return null;
    return this.db.pendingAction.findUnique({ where: { id } });
  }

  async resolve(id: string, status: Exclude<PendingActionStatus, "PENDING">) {
    if (!UUID_RE.test(id)) return false;
    const { count } = await this.db.pendingAction.updateMany({
      where: { id, status: "PENDING" },
      data: { status, resolvedAt: new Date() },
    });
    return count > 0;
  }

  async cancelAllOf(conversationId: string) {
    await this.db.pendingAction.updateMany({
      where: { conversationId, status: "PENDING" },
      data: { status: "CANCELLED", resolvedAt: new Date() },
    });
  }

  async setStatus(id: string, status: PendingActionStatus) {
    await this.db.pendingAction.updateMany({ where: { id }, data: { status } });
  }
}
