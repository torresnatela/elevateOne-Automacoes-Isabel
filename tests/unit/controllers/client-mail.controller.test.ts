import { NextRequest } from "next/server";
import { ClientMailController } from "@/server/controllers/client-mail.controller";
import { SESSION_COOKIE } from "@/server/models/session.model";
import type { ClientMailSyncService } from "@/server/services/client-mail-sync.service";
import type { ClientMailService, MailboxStatus } from "@/server/services/client-mail.service";
import { createSessionToken } from "@/server/services/session.service";

async function request(method = "GET") {
  const token = await createSessionToken({
    userId: "u1",
    name: "Ana",
    email: "a@a.com",
    role: "USER",
  });
  return new NextRequest("http://localhost/api/clients/sync", {
    method,
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
}

describe("ClientMailController.status", () => {
  it("lê o trinco antes das caixas, para o resultado gravado antes de o soltar aparecer", async () => {
    // A corrida acaba enquanto se lê o trinco: grava o erro e solta-o. Lendo as caixas só
    // depois, o painel vê o erro; lendo-as em paralelo (antes), veria as caixas antigas.
    let state: MailboxStatus[] = [
      { mailbox: "a@x.pt", lastRunAt: null, syncedUntil: null, lastError: null },
    ];
    const order: string[] = [];
    const sync = {
      runState: async () => {
        order.push("trinco");
        await Promise.resolve();
        state = [{ ...state[0], lastError: "A corrida falhou: base em baixo" }];
        return "idle";
      },
    } as unknown as ClientMailSyncService;
    const mail = {
      mailboxes: async () => {
        order.push("caixas");
        return state;
      },
    } as unknown as ClientMailService;
    const controller = new ClientMailController(
      mail,
      sync,
      () => undefined,
      () => undefined,
    );

    const res = await controller.status(await request());
    expect(order).toEqual(["trinco", "caixas"]);
    expect(await res.json()).toMatchObject({
      running: false,
      abandoned: false,
      mailboxes: [{ lastError: "A corrida falhou: base em baixo" }],
    });
  });

  it("diz quando a última corrida ficou abandonada (o trinco expirou sem se soltar)", async () => {
    const sync = { runState: async () => "abandoned" } as unknown as ClientMailSyncService;
    const mail = { mailboxes: async () => [] } as unknown as ClientMailService;
    const controller = new ClientMailController(
      mail,
      sync,
      () => undefined,
      () => undefined,
    );
    const res = await controller.status(await request());
    expect(await res.json()).toMatchObject({ running: false, abandoned: true });
  });

  it("o botão diz se começou a corrida", async () => {
    const sync = { start: async () => false } as unknown as ClientMailSyncService;
    const controller = new ClientMailController(
      {} as ClientMailService,
      sync,
      () => undefined,
      () => undefined,
    );
    const res = await controller.syncNow(await request("POST"));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ started: false });
  });
});
