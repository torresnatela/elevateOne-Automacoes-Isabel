import { AppError } from "@/server/lib/errors";
import type { Client, ClientData } from "@/server/models/client.model";
import type { ClientRepository } from "@/server/repositories/client.repository";

const notFound = () => new AppError("Cliente não encontrado.", 404, "CLIENT_NOT_FOUND");

/** O cadastro dos clientes do gabinete. */
export class ClientService {
  constructor(private readonly clients: ClientRepository) {}

  list(filter?: { query?: string; includeInactive?: boolean }): Promise<Client[]> {
    return this.clients.list(filter);
  }

  async get(id: string): Promise<Client> {
    const client = await this.clients.findById(id);
    if (!client) throw notFound();
    return client;
  }

  async create(data: ClientData): Promise<Client> {
    await this.checkUnique(data, null);
    return this.clients.create(data);
  }

  async update(id: string, data: ClientData): Promise<Client> {
    await this.checkUnique(data, id);
    const client = await this.clients.update(id, data);
    if (!client) throw notFound();
    return client;
  }

  async setActive(id: string, active: boolean): Promise<void> {
    if (!(await this.clients.setActive(id, active))) throw notFound();
  }

  /** O NIF e cada email só podem ser de um cliente: senão o agente não sabe a quem é o email. */
  private async checkUnique(data: ClientData, selfId: string | null) {
    if (data.nif) {
      const owner = await this.clients.findByNif(data.nif);
      if (owner && owner.id !== selfId)
        throw new AppError(`Esse NIF já é do cliente ${owner.name}.`, 409, "NIF_TAKEN");
    }
    if (data.contactEmails.length) {
      const owners = await this.clients.findByAddresses(data.contactEmails);
      for (const owner of owners) {
        if (owner.id === selfId) continue;
        const shared = data.contactEmails.find((e) => owner.contactEmails.includes(e));
        if (shared)
          throw new AppError(
            `O email ${shared} já é do cliente ${owner.name}.`,
            409,
            "CLIENT_EMAIL_TAKEN",
          );
      }
    }
  }
}
