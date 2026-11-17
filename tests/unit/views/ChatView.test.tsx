// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatView } from "@/views/components/ChatView";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const ndjson = (...events: unknown[]) =>
  new Response(events.map((e) => `${JSON.stringify(e)}\n`).join(""), {
    headers: { "content-type": "application/x-ndjson" },
  });

/** Responde a cada pedido pela rota e pelo método. */
function mockApi(routes: Record<string, () => Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    const route = routes[key];
    if (!route) throw new Error(`pedido inesperado: ${key}`);
    return route();
  });
}

describe("ChatView", () => {
  afterEach(() => vi.restoreAllMocks());

  it("cria a conversa, envia a pergunta e mostra a resposta", async () => {
    const fetchMock = mockApi({
      "POST /api/chat/conversations": () =>
        json({ conversation: { id: "c1", title: "Nova conversa" } }, 201),
      "POST /api/chat/conversations/c1/messages": () =>
        ndjson(
          { type: "tool", statusText: "A consultar a base de conhecimento…" },
          { type: "delta", text: "É **23 %**." },
          { type: "done", text: "É **23 %**." },
        ),
      "GET /api/chat/conversations": () =>
        json({ conversations: [{ id: "c1", title: "Qual é o IVA?" }] }),
    });
    render(<ChatView initialConversations={[]} />);

    await userEvent.type(screen.getByLabelText("Mensagem"), "Qual é o IVA?{Enter}");

    expect(await screen.findByText("23 %")).toBeInTheDocument();
    expect(screen.getByText("Qual é o IVA?", { selector: ".bubble" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Qual é o IVA?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Mensagem")).toHaveValue("");
    const sent = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/c1/messages"))!;
    expect(JSON.parse(sent[1]!.body as string)).toEqual({ text: "Qual é o IVA?" });
  });

  it("mostra o erro que chega a meio da resposta", async () => {
    mockApi({
      "POST /api/chat/conversations": () =>
        json({ conversation: { id: "c1", title: "Nova conversa" } }, 201),
      "POST /api/chat/conversations/c1/messages": () =>
        ndjson({ type: "error", message: "Não foi possível responder agora." }),
      "GET /api/chat/conversations": () => json({ conversations: [] }),
    });
    render(<ChatView initialConversations={[]} />);

    await userEvent.type(screen.getByLabelText("Mensagem"), "Olá{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível responder agora.");
  });

  it("abre uma conversa antiga com as suas mensagens", async () => {
    mockApi({
      "GET /api/chat/conversations/c9/messages": () =>
        json({
          messages: [
            { id: "m1", role: "USER", text: "Prazo do IRS?" },
            { id: "m2", role: "ASSISTANT", text: "Termina em junho." },
          ],
        }),
    });
    render(<ChatView initialConversations={[{ id: "c9", title: "Prazo do IRS?" }]} />);

    await userEvent.click(screen.getByRole("button", { name: "Prazo do IRS?" }));

    expect(await screen.findByText("Termina em junho.")).toBeInTheDocument();
  });

  it("Shift+Enter muda de linha sem enviar, e não envia uma mensagem vazia", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<ChatView initialConversations={[]} />);
    const box = screen.getByLabelText("Mensagem");

    await userEvent.type(box, "   {Enter}");
    await userEvent.clear(box);
    await userEvent.type(box, "linha um{Shift>}{Enter}{/Shift}linha dois");

    expect(box).toHaveValue("linha um\nlinha dois");
    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar" })).toBeEnabled());
  });
});
