import { Prisma, type PrismaClient } from "@prisma/client";

/** As mensagens já recebidas de fora (WhatsApp), para não tratar a mesma duas vezes. */
export interface InboundMessageRepository {
  /** Regista a mensagem. `false` se já tinha sido recebida. */
  claim(id: string): Promise<boolean>;
}

export class PrismaInboundMessageRepository implements InboundMessageRepository {
  constructor(private readonly db: PrismaClient) {}

  async claim(id: string) {
    try {
      await this.db.inboundMessage.create({ data: { id } });
      return true;
    } catch (error) {
      // P2002: já existe uma com este id.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        return false;
      throw error;
    }
  }
}
