import { ClientService } from "@/server/services/client.service";
import { clientSchema } from "@/server/validators/client.schemas";
import { FakeClientRepository } from "../../setup/fake-client.repository";

const data = (input: Record<string, unknown>) => clientSchema.parse({ name: "Cliente", ...input });

describe("ClientService", () => {
  let repo: FakeClientRepository;
  let service: ClientService;

  beforeEach(() => {
    repo = new FakeClientRepository();
    service = new ClientService(repo);
  });

  it("cria e devolve o cliente", async () => {
    const client = await service.create(data({ nif: "123456789" }));
    await expect(service.get(client.id)).resolves.toMatchObject({ nif: "123456789" });
  });

  it("não deixa dois clientes com o mesmo NIF", async () => {
    await service.create(data({ name: "A", nif: "123456789" }));
    await expect(service.create(data({ name: "B", nif: "123456789" }))).rejects.toMatchObject({
      code: "NIF_TAKEN",
    });
  });

  it("não deixa o mesmo email em dois clientes, mas deixa o cliente manter o seu", async () => {
    const a = await service.create(data({ name: "A", contactEmails: ["a@x.pt"] }));
    await expect(
      service.create(data({ name: "B", contactEmails: ["a@x.pt"] })),
    ).rejects.toMatchObject({ code: "CLIENT_EMAIL_TAKEN" });
    await expect(
      service.update(a.id, data({ name: "A2", contactEmails: ["a@x.pt"] })),
    ).resolves.toMatchObject({ name: "A2" });
  });

  it("dá 404 a um cliente que não existe", async () => {
    await expect(service.get("nada")).rejects.toMatchObject({ status: 404 });
    await expect(service.setActive("nada", false)).rejects.toMatchObject({ status: 404 });
  });
});
