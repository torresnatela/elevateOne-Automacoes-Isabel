import type { ToolContext, ToolDefinition } from "@/server/agents/core/types";
import { googleTools } from "@/server/agents/tools/google.tools";
import { GoogleNotConnectedError } from "@/server/services/google.service";
import { FakeGoogleWorkspace } from "../../setup/fake-google";

const ctx: ToolContext = { agentId: "a", conversationId: "c", channel: "WHATSAPP", userId: "u1" };
// Quinta-feira, 12 de novembro de 2026, 08:00 em Lisboa.
const now = () => new Date("2026-11-12T08:00:00Z");

function setup() {
  const workspace = new FakeGoogleWorkspace();
  const asked: Array<string | null> = [];
  const tools = googleTools(
    {
      workspaceFor: async (userId) => {
        asked.push(userId);
        return workspace;
      },
    },
    now,
  );
  /** Corre uma ferramenta como o runner: valida o input e executa. */
  const run = async (name: string, input: unknown) => {
    const tool = tools.find((t) => t.name === name) as ToolDefinition;
    return tool.execute(ctx, tool.schema.parse(input)) as Promise<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const tool = (name: string) => tools.find((t) => t.name === name)!;
  return { workspace, asked, tools, run, tool };
}

describe("ferramentas do Google", () => {
  it("as que escrevem exigem confirmação; as que só leem, não", () => {
    const { tools } = setup();
    const writes = tools.filter((t) => t.requiresConfirmation).map((t) => t.name);
    expect(writes.sort()).toEqual(
      ["agenda_alterar", "agenda_cancelar", "agenda_criar", "docs_criar", "gmail_enviar"].sort(),
    );
    expect(tools).toHaveLength(11);
    expect(new Set(tools.map((t) => t.name)).size).toBe(11);
  });

  it("agem na conta de quem fala com o agente", async () => {
    const t = setup();
    await t.run("contactos_procurar", { nome: "João" });
    expect(t.asked).toEqual(["u1"]);
  });

  it("sem conta ligada, o erro diz o que fazer", async () => {
    const [tool] = googleTools({
      workspaceFor: async () => {
        throw new GoogleNotConnectedError();
      },
    });
    await expect(
      tool.execute(ctx, tool.schema.parse({ de: "2026-11-12T00:00", ate: "2026-11-13T00:00" })),
    ).rejects.toThrow(/Integrações/);
  });
});

describe("agenda", () => {
  it("lista os compromissos com as horas de Lisboa", async () => {
    const t = setup();
    t.workspace.events = [
      {
        id: "e1",
        title: "Reunião com o João",
        start: "2026-07-01T14:00:00Z",
        end: "2026-07-01T15:00:00Z",
        allDay: false,
        attendees: ["joao@cliente.pt"],
        meetLink: "https://meet.google.com/abc",
        link: null,
        location: null,
      },
      {
        id: "e2",
        title: "Feriado",
        start: "2026-07-02",
        end: "2026-07-03",
        allDay: true,
        attendees: [],
        meetLink: null,
        link: null,
        location: null,
      },
    ];
    const result = await t.run("agenda_listar", {
      de: "2026-07-01T00:00",
      ate: "2026-07-03T00:00",
    });

    expect(result.compromissos).toEqual([
      {
        id: "e1",
        titulo: "Reunião com o João",
        inicio: "2026-07-01T15:00",
        fim: "2026-07-01T16:00",
        convidados: ["joao@cliente.pt"],
        meet: "https://meet.google.com/abc",
      },
      {
        id: "e2",
        titulo: "Feriado",
        inicio: "2026-07-02",
        fim: "2026-07-03",
        dia_inteiro: true,
        convidados: [],
      },
    ]);
    expect(t.workspace.calls[0]).toEqual([
      "listEvents",
      {
        from: new Date("2026-06-30T23:00:00Z"),
        to: new Date("2026-07-02T23:00:00Z"),
        query: undefined,
      },
    ]);
  });

  it("propõe os horários livres, sem as horas que já passaram", async () => {
    const t = setup();
    t.workspace.events = [
      {
        id: "e1",
        title: "Ocupado",
        start: "2026-11-12T10:00:00Z",
        end: "2026-11-12T16:30:00Z",
        allDay: false,
        attendees: [],
        meetLink: null,
        link: null,
        location: null,
      },
    ];
    const result = await t.run("agenda_horarios_livres", {
      de_dia: "2026-11-12",
      ate_dia: "2026-11-12",
    });

    expect(result.livres).toEqual([
      { inicio: "2026-11-12T09:00", fim: "2026-11-12T10:00" },
      { inicio: "2026-11-12T16:30", fim: "2026-11-12T18:00" },
    ]);
  });

  it("marca com Meet por omissão, na hora de Lisboa", async () => {
    const t = setup();
    const result = await t.run("agenda_criar", {
      titulo: "Reunião com o João",
      inicio: "2026-11-13T15:00",
      fim: "2026-11-13T15:30",
      convidados: ["joao@cliente.pt"],
    });

    expect(result.marcado).toMatchObject({
      titulo: "Reunião com o João",
      convidados: ["joao@cliente.pt"],
      meet: expect.stringContaining("meet.google.com"),
    });
  });

  it("recusa um fim antes do início, uma data mal escrita e um email inválido", () => {
    const { tool } = setup();
    const base = { titulo: "R", inicio: "2026-11-13T15:00", fim: "2026-11-13T15:30" };
    const criar = tool("agenda_criar").schema;
    expect(criar.safeParse(base).success).toBe(true);
    expect(criar.safeParse({ ...base, fim: "2026-11-13T14:00" }).success).toBe(false);
    expect(criar.safeParse({ ...base, inicio: "amanhã às 15h" }).success).toBe(false);
    expect(criar.safeParse({ ...base, convidados: ["o João"] }).success).toBe(false);
  });

  it("altera só o que foi pedido e cancela pelo id", async () => {
    const t = setup();
    await t.run("agenda_criar", {
      titulo: "R",
      inicio: "2026-11-13T15:00",
      fim: "2026-11-13T15:30",
    });
    await t.run("agenda_alterar", {
      id: "ev1",
      inicio: "2026-11-13T16:00",
      fim: "2026-11-13T16:30",
    });

    expect(t.workspace.calls.at(-1)).toEqual([
      "updateEvent",
      "ev1",
      expect.objectContaining({
        start: "2026-11-13T16:00",
        end: "2026-11-13T16:30",
        title: undefined,
      }),
    ]);
    await expect(t.run("agenda_cancelar", { id: "ev1" })).resolves.toEqual({ cancelado: true });
    expect(t.workspace.events).toEqual([]);
  });

  it("não vê mais de um mês de cada vez", async () => {
    const t = setup();
    await expect(
      t.run("agenda_horarios_livres", { de_dia: "2026-11-12", ate_dia: "2027-02-12" }),
    ).rejects.toThrow(/um mês/);
  });
});

describe("email, contactos, Drive e Docs", () => {
  it("procura emails com o limite por omissão e lê um pelo id", async () => {
    const t = setup();
    t.workspace.emails = [
      {
        id: "m1",
        from: "joao@cliente.pt",
        to: "eu",
        subject: "Fatura",
        date: "hoje",
        snippet: "…",
        body: "Segue.",
      },
    ];
    const found = await t.run("gmail_procurar", { pesquisa: "from:joao" });
    expect(found.emails).toEqual([
      {
        id: "m1",
        from: "joao@cliente.pt",
        to: "eu",
        subject: "Fatura",
        date: "hoje",
        snippet: "…",
      },
    ]);
    expect(t.workspace.calls[0]).toEqual(["searchEmails", "from:joao", 10]);
    await expect(t.run("gmail_ler", { id: "m1" })).resolves.toMatchObject({
      email: { body: "Segue." },
    });
  });

  it("envia um email", async () => {
    const t = setup();
    const result = await t.run("gmail_enviar", {
      para: ["joao@cliente.pt"],
      assunto: "Reunião",
      texto: "Olá João, confirmo.",
    });
    expect(result).toEqual({ enviado: true, id: "sent1" });
    expect(t.workspace.sent).toEqual([
      { to: ["joao@cliente.pt"], cc: [], subject: "Reunião", body: "Olá João, confirmo." },
    ]);
    expect(
      t.tool("gmail_enviar").schema.safeParse({ para: [], assunto: "x", texto: "y" }).success,
    ).toBe(false);
  });

  it("procura contactos, ficheiros e cria documentos", async () => {
    const t = setup();
    t.workspace.contacts = [{ name: "João Silva", emails: ["joao@cliente.pt"], phones: [] }];
    t.workspace.files = [
      { id: "f1", name: "Contrato", mimeType: "application/pdf", link: "l", modifiedAt: null },
    ];

    await expect(t.run("contactos_procurar", { nome: "joão" })).resolves.toEqual({
      contactos: [{ nome: "João Silva", emails: ["joao@cliente.pt"], telefones: [] }],
    });
    await expect(t.run("drive_procurar", { pesquisa: "contrato" })).resolves.toMatchObject({
      ficheiros: [{ id: "f1", nome: "Contrato" }],
    });
    await expect(
      t.run("docs_criar", { titulo: "Ata", texto: "Presentes: Isabel." }),
    ).resolves.toEqual({
      criado: { id: "doc1", link: "https://docs.google.com/document/d/doc1/edit" },
    });
    expect(t.workspace.documents).toEqual([{ title: "Ata", text: "Presentes: Isabel." }]);
  });
});

describe("o resumo mostrado antes de confirmar", () => {
  const describeOf = async (t: ReturnType<typeof setup>, name: string, input: unknown) => {
    const tool = t.tool(name) as ToolDefinition;
    return tool.describe!(ctx, tool.schema.parse(input));
  };

  it("todas as que escrevem têm resumo", () => {
    const { tools } = setup();
    for (const tool of tools.filter((x) => x.requiresConfirmation))
      expect(tool.describe).toBeDefined();
  });

  it("marcar: o título, o dia por extenso, os convidados e o Meet", async () => {
    const t = setup();
    const text = await describeOf(t, "agenda_criar", {
      titulo: "Reunião com o João",
      inicio: "2026-11-13T15:00",
      fim: "2026-11-13T15:30",
      convidados: ["joao@cliente.pt"],
    });
    expect(text).toBe(
      "Marcar «Reunião com o João»\nsexta-feira, 13 de novembro de 2026 às 15:00 até às 15:30\nConvidados: joao@cliente.pt\nCom link do Google Meet",
    );
  });

  it("cancelar e alterar: dizem qual é o compromisso, lido da agenda", async () => {
    const t = setup();
    await t.run("agenda_criar", {
      titulo: "Reunião com o João",
      inicio: "2026-11-13T15:00",
      fim: "2026-11-13T15:30",
      convidados: ["joao@cliente.pt"],
    });
    // O Google devolve instantes: o fake guardou a hora de parede, acerta-se aqui.
    t.workspace.events[0].start = "2026-11-13T15:00:00Z";
    t.workspace.events[0].end = "2026-11-13T15:30:00Z";

    const cancel = await describeOf(t, "agenda_cancelar", { id: "ev1" });
    expect(cancel).toContain("Cancelar «Reunião com o João»");
    expect(cancel).toContain("13 de novembro");
    expect(cancel).toContain("Convidados: joao@cliente.pt");

    const change = await describeOf(t, "agenda_alterar", {
      id: "ev1",
      inicio: "2026-11-16T10:00",
      fim: "2026-11-16T10:30",
    });
    expect(change).toContain("Alterar «Reunião com o João»");
    expect(change).toMatch(/Nova hora: segunda-feira, 16 de novembro de 2026.*10:00 até às 10:30/);
  });

  it("não propõe cancelar um compromisso que não existe", async () => {
    const t = setup();
    await expect(describeOf(t, "agenda_cancelar", { id: "nao-existe" })).rejects.toThrow(
      /não existe/,
    );
  });

  it("enviar email: os destinatários, o assunto e o texto inteiro", async () => {
    const t = setup();
    const text = await describeOf(t, "gmail_enviar", {
      para: ["joao@cliente.pt"],
      cc: ["ana@cliente.pt"],
      assunto: "Reunião",
      texto: "Olá João,\nconfirmo a reunião.",
    });
    expect(text).toBe(
      "Enviar um email\nPara: joao@cliente.pt\nCc: ana@cliente.pt\nAssunto: Reunião\n\nOlá João,\nconfirmo a reunião.",
    );
  });

  it("criar documento: o título e o início do texto", async () => {
    const t = setup();
    const text = await describeOf(t, "docs_criar", { titulo: "Ata", texto: "x".repeat(400) });
    expect(text).toContain("Criar o documento «Ata»");
    expect(text.endsWith("…")).toBe(true);
  });
});
