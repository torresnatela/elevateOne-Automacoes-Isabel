// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KnowledgeManager, type KnowledgeDocumentView } from "@/views/components/KnowledgeManager";

const doc: KnowledgeDocumentView = {
  id: "d1",
  title: "Guia do IVA",
  fileName: "iva.pdf",
  size: 2 * 1024 * 1024,
  chunkCount: 12,
  createdAt: "2026-11-10T10:00:00.000Z",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// O jsdom não vê o ficheiro escolhido como preenchido e trava o clique em «Enviar»: envia-se o formulário.
const submit = () =>
  fireEvent.submit(screen.getByRole("button", { name: "Enviar" }).closest("form")!);

describe("KnowledgeManager", () => {
  afterEach(() => vi.restoreAllMocks());

  it("avisa quando ainda não há ficheiros", () => {
    render(<KnowledgeManager initialDocuments={[]} />);
    expect(screen.getByText(/Ainda não há ficheiros/)).toBeInTheDocument();
  });

  it("mostra os ficheiros com tamanho e pedaços", () => {
    render(<KnowledgeManager initialDocuments={[doc]} />);
    expect(screen.getByText("Guia do IVA")).toBeInTheDocument();
    expect(screen.getByText("2.0 MB")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("envia um ficheiro e acrescenta-o à lista", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(json({ document: { ...doc, id: "d2", title: "Guia do IRS" } }, 201));
    render(<KnowledgeManager initialDocuments={[doc]} />);

    await userEvent.upload(
      screen.getByLabelText(/Ficheiro/),
      new File(["x"], "irs.pdf", { type: "application/pdf" }),
    );
    submit();

    expect(await screen.findByText("Guia do IRS")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/knowledge/documents");
    expect(init?.method).toBe("POST");
    expect((init?.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("mostra o erro que o servidor devolveu", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ error: { code: "NO_TEXT_FOUND", message: "Não foi possível ler texto." } }, 422),
    );
    render(<KnowledgeManager initialDocuments={[]} />);

    await userEvent.upload(screen.getByLabelText(/Ficheiro/), new File(["x"], "a.pdf"));
    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível ler texto.");
  });

  it("apaga um ficheiro depois de confirmar", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ ok: true }));
    render(<KnowledgeManager initialDocuments={[doc]} />);

    await userEvent.click(screen.getByRole("button", { name: "Apagar Guia do IVA" }));

    await waitFor(() => expect(screen.queryByText("Guia do IVA")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/knowledge/documents/d1", {
      method: "DELETE",
    });
  });

  it("não apaga se a pessoa desistir", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<KnowledgeManager initialDocuments={[doc]} />);

    await userEvent.click(screen.getByRole("button", { name: "Apagar Guia do IVA" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Guia do IVA")).toBeInTheDocument();
  });
});
