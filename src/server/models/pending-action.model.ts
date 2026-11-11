/** Uma ação que escreve no mundo, à espera do «sim» de quem pediu. Independente do Prisma. */
export type PendingActionStatus = "PENDING" | "CONFIRMED" | "CANCELLED" | "EXPIRED" | "FAILED";

export interface PendingAction {
  id: string;
  conversationId: string;
  /** A vez (mensagem) em que foi proposta: só pode ser confirmada numa vez seguinte. */
  runId: string;
  toolName: string;
  input: unknown;
  /** O que foi mostrado a quem pediu. */
  description: string;
  status: PendingActionStatus;
  expiresAt: Date;
  createdAt: Date;
}

export type NewPendingAction = Pick<
  PendingAction,
  "conversationId" | "runId" | "toolName" | "input" | "description" | "expiresAt"
>;
