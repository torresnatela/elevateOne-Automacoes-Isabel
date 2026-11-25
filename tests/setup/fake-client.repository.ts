import { randomUUID } from "node:crypto";
import { domainOf, type Client, type ClientData } from "@/server/models/client.model";
import type { ClientRepository } from "@/server/repositories/client.repository";

/** Repositório de clientes em memória. */
export class FakeClientRepository implements ClientRepository {
  clients: Client[] = [];

  async list(filter: { query?: string; includeInactive?: boolean } = {}) {
    const q = filter.query?.toLowerCase();
    return this.clients
      .filter((c) => filter.includeInactive || c.active)
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.nif?.includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async findById(id: string) {
    return this.clients.find((c) => c.id === id) ?? null;
  }

  async findByNif(nif: string) {
    return this.clients.find((c) => c.nif === nif) ?? null;
  }

  async findByAddresses(addresses: string[]) {
    const emails = addresses.map((a) => a.toLowerCase());
    const domains = emails.map(domainOf);
    return this.clients.filter(
      (c) =>
        c.active &&
        (c.contactEmails.some((e) => emails.includes(e)) ||
          c.emailDomains.some((d) => domains.includes(d))),
    );
  }

  async create(data: ClientData) {
    const now = new Date();
    const client: Client = {
      ...data,
      id: randomUUID(),
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    this.clients.push(client);
    return client;
  }

  async update(id: string, data: ClientData) {
    const client = this.clients.find((c) => c.id === id);
    if (!client) return null;
    Object.assign(client, data, { updatedAt: new Date() });
    return client;
  }

  async setActive(id: string, active: boolean) {
    const client = this.clients.find((c) => c.id === id);
    if (!client) return false;
    client.active = active;
    return true;
  }
}
