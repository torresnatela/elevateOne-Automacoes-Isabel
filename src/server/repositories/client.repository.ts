import { Prisma, type PrismaClient } from "@prisma/client";
import { AppError } from "@/server/lib/errors";
import { domainOf, type Client, type ClientData } from "@/server/models/client.model";

/** Um email do cliente já é de outro cliente (ativo ou não). */
export class ClientEmailTakenError extends AppError {
  constructor(email: string, owner: string) {
    super(`O email ${email} já é do cliente ${owner}.`, 409, "CLIENT_EMAIL_TAKEN");
  }
}

/** Um NIF só com dígitos, espaços, pontos e um «PT» opcional: é por NIF que se procura. */
const looksLikeNif = (q: string) => /^(PT)?[\d\s.]+$/i.test(q);

/** Contrato de persistência dos clientes. */
export interface ClientRepository {
  /** Por nome. Com `query`, só os que batem no nome, nome comercial, NIF ou email. */
  list(filter?: { query?: string; includeInactive?: boolean }): Promise<Client[]>;
  findById(id: string): Promise<Client | null>;
  findByNif(nif: string): Promise<Client | null>;
  /** Os clientes ativos que têm algum destes endereços, ou o domínio de algum deles. */
  findByAddresses(addresses: string[]): Promise<Client[]>;
  /** Os clientes (ativos ou não) que têm algum destes endereços exatos. */
  findByContactEmails(emails: string[]): Promise<Client[]>;
  /** Cria. Falha com `ClientEmailTakenError` se um dos emails já for de outro cliente. */
  create(data: ClientData): Promise<Client>;
  /** `null` se o cliente não existe. Falha como `create` se um email já for de outro cliente. */
  update(id: string, data: ClientData): Promise<Client | null>;
  /** `false` se o cliente não existe. */
  setActive(id: string, active: boolean): Promise<boolean>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PrismaClientRepository implements ClientRepository {
  constructor(private readonly db: PrismaClient) {}

  async list(filter: { query?: string; includeInactive?: boolean } = {}) {
    const q = filter.query?.trim();
    const where: Prisma.ClientWhereInput = {
      ...(filter.includeInactive ? {} : { active: true }),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { tradeName: { contains: q, mode: "insensitive" } },
              ...(looksLikeNif(q) ? [{ nif: { contains: q.replace(/\D/g, "") } }] : []),
              { contactEmails: { has: q.toLowerCase() } },
            ],
          }
        : {}),
    };
    return this.db.client.findMany({ where, orderBy: { name: "asc" } }) as Promise<Client[]>;
  }

  async findById(id: string) {
    if (!UUID_RE.test(id)) return null;
    return (await this.db.client.findUnique({ where: { id } })) as Client | null;
  }

  async findByNif(nif: string) {
    return (await this.db.client.findUnique({ where: { nif } })) as Client | null;
  }

  async findByAddresses(addresses: string[]) {
    const emails = [...new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean))];
    if (emails.length === 0) return [];
    const domains = [...new Set(emails.map(domainOf).filter(Boolean))];
    return (await this.db.client.findMany({
      where: {
        active: true,
        OR: [{ contactEmails: { hasSome: emails } }, { emailDomains: { hasSome: domains } }],
      },
      orderBy: { name: "asc" },
    })) as Client[];
  }

  async findByContactEmails(emails: string[]) {
    const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    if (list.length === 0) return [];
    return (await this.db.client.findMany({
      where: { contactEmails: { hasSome: list } },
    })) as Client[];
  }

  /**
   * Escreve com os emails verificados na mesma transação, sob um trinco: dois pedidos ao mesmo
   * tempo com o mesmo email não passam os dois (a base não tem um índice único para arrays).
   */
  private writeChecked<T>(
    emails: string[],
    selfId: string | null,
    write: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('clients.contact_emails'))`;
      if (emails.length) {
        const owner = await tx.client.findFirst({
          where: { contactEmails: { hasSome: emails }, ...(selfId ? { NOT: { id: selfId } } : {}) },
        });
        if (owner)
          throw new ClientEmailTakenError(
            emails.find((e) => owner.contactEmails.includes(e)) ?? emails[0],
            owner.name,
          );
      }
      return write(tx);
    });
  }

  async create(data: ClientData) {
    return this.writeChecked(
      data.contactEmails,
      null,
      async (tx) => (await tx.client.create({ data })) as Client,
    );
  }

  async update(id: string, data: ClientData) {
    if (!UUID_RE.test(id)) return null;
    try {
      return await this.writeChecked(
        data.contactEmails,
        id,
        async (tx) => (await tx.client.update({ where: { id }, data })) as Client,
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") return null;
      throw err;
    }
  }

  async setActive(id: string, active: boolean) {
    if (!UUID_RE.test(id)) return false;
    const { count } = await this.db.client.updateMany({ where: { id }, data: { active } });
    return count > 0;
  }
}
