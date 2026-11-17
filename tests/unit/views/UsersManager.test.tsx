// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChangePasswordForm } from "@/views/components/ChangePasswordForm";
import { UsersManager, type UserView } from "@/views/components/UsersManager";

const isabel: UserView = {
  id: "u1",
  name: "Isabel",
  email: "isabel@e.pt",
  role: "ADMIN",
  active: true,
};
const rui: UserView = { id: "u2", name: "Rui", email: "rui@e.pt", role: "USER", active: true };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const rowOf = (name: string) => screen.getByRole("cell", { name }).closest("tr")!;

describe("UsersManager", () => {
  afterEach(() => vi.restoreAllMocks());

  it("cria um utilizador e acrescenta-o à lista", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        json(
          { user: { id: "u3", name: "Ana", email: "ana@e.pt", role: "USER", active: true } },
          201,
        ),
      );
    render(<UsersManager initialUsers={[isabel, rui]} currentUserId="u1" />);

    await userEvent.type(screen.getByLabelText("Nome"), "Ana");
    await userEvent.type(screen.getByLabelText("E-mail"), "ana@e.pt");
    await userEvent.type(screen.getByLabelText(/Senha inicial/), "Senha-da-Ana-1");
    await userEvent.click(screen.getByRole("button", { name: "Criar utilizador" }));

    expect(await screen.findByRole("cell", { name: "Ana" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Ana já pode entrar");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/users");
    expect(JSON.parse(init!.body as string)).toEqual({
      name: "Ana",
      email: "ana@e.pt",
      password: "Senha-da-Ana-1",
      role: "USER",
    });
  });

  it("mostra o erro do servidor (um e-mail repetido)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json(
        { error: { code: "EMAIL_TAKEN", message: "Já existe um utilizador com esse e-mail." } },
        409,
      ),
    );
    render(<UsersManager initialUsers={[isabel]} currentUserId="u1" />);

    await userEvent.type(screen.getByLabelText("Nome"), "Rui");
    await userEvent.type(screen.getByLabelText("E-mail"), "rui@e.pt");
    await userEvent.type(screen.getByLabelText(/Senha inicial/), "Senha-do-Rui-1");
    await userEvent.click(screen.getByRole("button", { name: "Criar utilizador" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Já existe um utilizador");
  });

  it("desativa depois de confirmar, e não deixa desativar a própria conta", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ ok: true }));
    render(<UsersManager initialUsers={[isabel, rui]} currentUserId="u1" />);

    expect(within(rowOf("Isabel")).queryByRole("button", { name: "Desativar" })).toBeNull();
    await userEvent.click(within(rowOf("Rui")).getByRole("button", { name: "Desativar" }));

    expect(await within(rowOf("Rui")).findByText("Desativado")).toBeInTheDocument();
    expect(within(rowOf("Rui")).getByRole("button", { name: "Reativar" })).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/users/u2/active");
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ active: false });
  });

  it("repõe a senha com a que o admin escrever", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("Senha-reposta-1");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ ok: true }));
    render(<UsersManager initialUsers={[isabel, rui]} currentUserId="u1" />);

    await userEvent.click(within(rowOf("Rui")).getByRole("button", { name: "Repor senha" }));

    expect(await screen.findByRole("status")).toHaveTextContent("A senha de Rui foi trocada");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/users/u2/password");
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({
      password: "Senha-reposta-1",
    });
  });
});

describe("ChangePasswordForm", () => {
  afterEach(() => vi.restoreAllMocks());

  const fill = async (current: string, next: string, repeat: string) => {
    await userEvent.type(screen.getByLabelText("Senha atual"), current);
    await userEvent.type(screen.getByLabelText(/^Senha nova/), next);
    await userEvent.type(screen.getByLabelText("Repita a senha nova"), repeat);
    fireEvent.submit(screen.getByRole("button", { name: "Trocar senha" }).closest("form")!);
  };

  it("troca a senha e limpa o formulário", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ ok: true }));
    render(<ChangePasswordForm />);
    await fill("atual-12345", "nova-senha-1", "nova-senha-1");

    expect(await screen.findByRole("status")).toHaveTextContent("Senha trocada.");
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({
      currentPassword: "atual-12345",
      newPassword: "nova-senha-1",
    });
    expect(screen.getByLabelText("Senha atual")).toHaveValue("");
  });

  it("não envia se as duas senhas novas forem diferentes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<ChangePasswordForm />);
    await fill("atual-12345", "nova-senha-1", "nova-senha-2");

    expect(await screen.findByRole("alert")).toHaveTextContent("não são iguais");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mostra o erro quando a senha atual está errada", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json(
        { error: { code: "INVALID_CURRENT_PASSWORD", message: "A senha atual não está certa." } },
        400,
      ),
    );
    render(<ChangePasswordForm />);
    await fill("errada", "nova-senha-1", "nova-senha-1");

    expect(await screen.findByRole("alert")).toHaveTextContent("A senha atual não está certa.");
  });
});
