import { NextRequest } from "next/server";
import { UserAdminController } from "@/server/controllers/user-admin.controller";
import { WhatsappController } from "@/server/controllers/whatsapp.controller";
import { SESSION_COOKIE } from "@/server/models/session.model";
import type { Role } from "@/server/models/user.model";
import { createSessionToken } from "@/server/services/session.service";
import { UserAdminService } from "@/server/services/user-admin.service";
import { FakeUserRepository } from "../../setup/fake-user.repository";

function post(body: string, secret?: string) {
  return new NextRequest("http://localhost/api/webhooks/whatsapp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-webhook-secret": secret } : {}),
    },
    body,
  });
}

function setup(secret: string | undefined = "segredo-1") {
  const handled: unknown[] = [];
  const deferred: Array<() => Promise<void>> = [];
  const controller = new WhatsappController(
    {
      handle: async (payload) => {
        handled.push(payload);
        if ((payload as { boom?: boolean }).boom) throw new Error("rebentou");
        return "replied";
      },
    },
    () => secret,
    (task) => deferred.push(task),
  );
  return { controller, handled, deferred };
}

describe("WhatsappController", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("responde logo e trata a mensagem depois", async () => {
    const t = setup();
    const res = await t.controller.webhook(post('{"event":"messages.upsert"}', "segredo-1"));

    expect(res.status).toBe(200);
    expect(t.handled).toEqual([]);
    await t.deferred[0]();
    expect(t.handled).toEqual([{ event: "messages.upsert" }]);
  });

  it("401 sem o segredo ou com o segredo errado, e nada é tratado", async () => {
    const t = setup();
    expect((await t.controller.webhook(post("{}"))).status).toBe(401);
    expect((await t.controller.webhook(post("{}", "outro"))).status).toBe(401);
    expect(t.deferred).toEqual([]);
  });

  it("sem segredo configurado, recusa tudo (nem um segredo vazio passa)", async () => {
    const t = setup("");
    expect((await t.controller.webhook(post("{}", ""))).status).toBe(503);
    expect((await t.controller.webhook(post("{}"))).status).toBe(503);
  });

  it("400 com um corpo que não é JSON", async () => {
    const t = setup();
    expect((await t.controller.webhook(post("isto não é json", "segredo-1"))).status).toBe(400);
  });

  it("um erro ao tratar não escapa da tarefa", async () => {
    const t = setup();
    await t.controller.webhook(post('{"boom":true}', "segredo-1"));
    await expect(t.deferred[0]()).resolves.toBeUndefined();
  });
});

describe("números de WhatsApp (admin)", () => {
  async function request(role: Role, phone: unknown) {
    const token = await createSessionToken({ userId: "adm", name: "A", email: "a@a.pt", role });
    return new NextRequest("http://localhost/api/admin/users/x/phone", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
      body: JSON.stringify({ phone }),
    });
  }

  async function withUsers() {
    const users = new FakeUserRepository();
    const isabel = await users.create({ name: "Isabel", email: "i@e.pt", passwordHash: "h" });
    const rui = await users.create({ name: "Rui", email: "r@e.pt", passwordHash: "h" });
    return { users, isabel, rui, controller: new UserAdminController(new UserAdminService(users)) };
  }

  it("guarda o número só com dígitos, e tira-o com vazio", async () => {
    const t = await withUsers();
    const res = await t.controller.setPhone(
      await request("ADMIN", "+351 912 345 678"),
      t.isabel.id,
    );
    expect(await res.json()).toEqual({ phone: "351912345678" });
    expect((await t.users.findByPhone("351912345678"))?.id).toBe(t.isabel.id);

    const cleared = await t.controller.setPhone(await request("ADMIN", ""), t.isabel.id);
    expect(await cleared.json()).toEqual({ phone: null });
  });

  it("403 para quem não é admin", async () => {
    const t = await withUsers();
    expect(
      (await t.controller.setPhone(await request("USER", "351912345678"), t.isabel.id)).status,
    ).toBe(403);
  });

  it("400 com um número inválido, 409 se já é de outra pessoa, 404 sem utilizador", async () => {
    const t = await withUsers();
    await t.controller.setPhone(await request("ADMIN", "351912345678"), t.isabel.id);

    expect((await t.controller.setPhone(await request("ADMIN", "123"), t.rui.id)).status).toBe(400);
    expect(
      (await t.controller.setPhone(await request("ADMIN", "351 912 345 678"), t.rui.id)).status,
    ).toBe(409);
    expect(
      (await t.controller.setPhone(await request("ADMIN", "351912345678"), t.isabel.id)).status,
    ).toBe(200);
    expect(
      (await t.controller.setPhone(await request("ADMIN", "351900000000"), "nao-existe")).status,
    ).toBe(404);
  });

  it("lista os utilizadores sem o hash da senha", async () => {
    const t = await withUsers();
    const token = await createSessionToken({
      userId: "adm",
      name: "A",
      email: "a@a.pt",
      role: "ADMIN",
    });
    const res = await t.controller.list(
      new NextRequest("http://localhost/api/admin/users", {
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      }),
    );
    const body = await res.json();
    expect(body.users.map((u: { name: string }) => u.name)).toEqual(["Isabel", "Rui"]);
    expect(JSON.stringify(body)).not.toContain("passwordHash");
  });
});
