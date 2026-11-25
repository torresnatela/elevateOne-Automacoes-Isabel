import { Prisma, type PrismaClient } from "@prisma/client";
import { domainOf, type Client, type ClientData } from "@/server/models/client.model";

/** Contrato de persistência dos clientes. */
export interface ClientRepository {
  /** Por nome. Com `query`, só os que batem no nome, nome comercial, NIF ou email. */
  list(filter?: { query?: string; includeInactive?: boolean }): Promise<Client[]>;
  findById(id: string): Promise<Client | null>;
  findByNif(nif: string): Promise<Client | null>;
  /** Os clientes ativos que têm algum destes endereços, ou o domínio de algum deles. */
  findByAddresses(addresses: string[]): Promise<Client[]>;
  create(data: ClientData): Promise<Client>;
  /** `null` se o cliente não existe. */
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
              { nif: { contains: q.replace(/\D/g, "") || q } },
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

  async create(data: ClientData) {
    return (await this.db.client.create({ data })) as Client;
  }

  async update(id: string, data: ClientData) {
    if (!UUID_RE.test(id)) return null;
    try {
      return (await this.db.client.update({ where: { id }, data })) as Client;
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
