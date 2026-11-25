import { NextRequest } from "next/server";
import { AgentSettingsController } from "@/server/controllers/agent-settings.controller";
import { KnowledgeController } from "@/server/controllers/knowledge.controller";
import { AgentRegistry } from "@/server/agents/registry";
import { SESSION_COOKIE } from "@/server/models/session.model";
import type { Role } from "@/server/models/user.model";
import { AgentSettingsService } from "@/server/services/agent-settings.service";
import { KnowledgeService } from "@/server/services/knowledge.service";
import { createSessionToken } from "@/server/services/session.service";
import {
  FakeAgentSettingRepository,
  FakeKnowledgeRepository,
  FakeTextExtractor,
} from "../../setup/fake-knowledge";

const cookieOf = async (role: Role) =>
  `${SESSION_COOKIE}=${await createSessionToken({ userId: "u1", name: "Ana", email: "a@a.com", role })}`;

async function request(
  role: Role | null,
  init: { method?: string; body?: BodyInit; json?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (role) headers.cookie = await cookieOf(role);
  if (init.json !== undefined) headers["content-type"] = "application/json";
  return new NextRequest("http://localhost/api/admin/x", {
    method: init.method ?? "GET",
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
}

function upload(name = "guia.txt", title?: string) {
  const form = new FormData();
  form.set("file", new File(["O IVA normal é 23 %."], name, { type: "text/plain" }));
  if (title) form.set("title", title);
  return form;
}

describe("KnowledgeController", () => {
  let repository: FakeKnowledgeRepository;
  let controller: KnowledgeController;

  beforeEach(() => {
    repository = new FakeKnowledgeRepository();
    controller = new KnowledgeController(
      new KnowledgeService(repository, new FakeTextExtractor("O IVA normal é 23 %.")),
    );
  });

  it("401 sem sessão e 403 para quem não é admin", async () => {
    expect((await controller.list(await request(null))).status).toBe(401);
    expect((await controller.list(await request("USER"))).status).toBe(403);
    const res = await controller.upload(await request("USER", { method: "POST", body: upload() }));
    expect(res.status).toBe(403);
    expect((await controller.remove(await request("USER", { method: "DELETE" }), "x")).status).toBe(
      403,
    );
    expect(repository.documents).toEqual([]);
  });

  it("201 ao receber um ficheiro, guardado em nome de quem o enviou", async () => {
    const res = await controller.upload(
      await request("ADMIN", { method: "POST", body: upload("guia.txt", "Guia do IVA") }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).document).toMatchObject({
      title: "Guia do IVA",
      fileName: "guia.txt",
      chunkCount: 1,
      uploadedById: "u1",
    });
  });

  it("400 sem ficheiro", async () => {
    const res = await controller.upload(
      await request("ADMIN", { method: "POST", body: new FormData() }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("FILE_REQUIRED");
  });

  it("lista e apaga", async () => {
    await controller.upload(await request("ADMIN", { method: "POST", body: upload() }));
    const listed = await (await controller.list(await request("ADMIN"))).json();
    expect(listed.documents).toHaveLength(1);

    const id = listed.documents[0].id;
    expect((await controller.remove(await request("ADMIN", { method: "DELETE" }), id)).status).toBe(
      200,
    );
    expect((await controller.remove(await request("ADMIN", { method: "DELETE" }), id)).status).toBe(
      404,
    );
  });
});

describe("AgentSettingsController", () => {
  const registry = new AgentRegistry().registerAgent({
    id: "assistente",
    name: "Assistente",
    prompt: "De origem.",
    tools: [],
    channels: ["WEB"],
    office: { agentId: "eva", workingText: "A responder" },
  });
  let controller: AgentSettingsController;

  beforeEach(() => {
    controller = new AgentSettingsController(
      new AgentSettingsService(registry, new FakeAgentSettingRepository()),
    );
  });

  it("403 para quem não é admin", async () => {
    const res = await controller.setPrompt(
      await request("USER", { method: "PUT", json: { prompt: "x" } }),
      "assistente",
    );
    expect(res.status).toBe(403);
  });

  it("muda as instruções e repõe as de origem", async () => {
    const put = await controller.setPrompt(
      await request("ADMIN", { method: "PUT", json: { prompt: "Novas." } }),
      "assistente",
    );
    expect(put.status).toBe(200);
    let body = await (await controller.list(await request("ADMIN"))).json();
    expect(body.agents[0]).toMatchObject({ prompt: "Novas.", customized: true });

    await controller.resetPrompt(await request("ADMIN", { method: "DELETE" }), "assistente");
    body = await (await controller.list(await request("ADMIN"))).json();
    expect(body.agents[0]).toMatchObject({ prompt: "De origem.", customized: false });
  });

  it("400 com instruções vazias e 404 para um agente que não existe", async () => {
    const empty = await controller.setPrompt(
      await request("ADMIN", { method: "PUT", json: { prompt: "  " } }),
      "assistente",
    );
    expect(empty.status).toBe(400);
    const missing = await controller.setPrompt(
      await request("ADMIN", { method: "PUT", json: { prompt: "x" } }),
      "nao-existe",
    );
    expect(missing.status).toBe(404);
  });
});
