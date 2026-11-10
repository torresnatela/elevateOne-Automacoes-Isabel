// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginForm } from "@/views/components/LoginForm";

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function fillAndSubmit(email = "admin@elevateone.local", password = "Admin@123") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/e-mail/i), email);
  await user.type(screen.getByLabelText(/senha/i), password);
  await user.click(screen.getByRole("button", { name: /entrar/i }));
}

describe("<LoginForm />", () => {
  beforeEach(() => {
    replace.mockReset();
    refresh.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("envia credenciais e redireciona para o destino informado", async () => {
    const fetchMock = mockFetch(200, { user: { id: "1" } });
    render(<LoginForm next="/admin" />);
    await fillAndSubmit();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "admin@elevateone.local", password: "Admin@123" }),
      }),
    );
    expect(replace).toHaveBeenCalledWith("/admin");
    expect(refresh).toHaveBeenCalled();
  });

  it("redireciona para /dashboard por padrão e ignora next externo", async () => {
    mockFetch(200, { user: { id: "1" } });
    render(<LoginForm next="https://malicioso.com" />);
    await fillAndSubmit();
    expect(replace).toHaveBeenCalledWith("/dashboard");
  });

  it("exibe a mensagem de erro da API e não redireciona", async () => {
    mockFetch(401, { error: { code: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos" } });
    render(<LoginForm />);
    await fillAndSubmit("admin@elevateone.local", "errada");

    expect(await screen.findByRole("alert")).toHaveTextContent("E-mail ou senha inválidos");
    expect(replace).not.toHaveBeenCalled();
  });

  it("exibe erro genérico se a rede falhar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<LoginForm />);
    await fillAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/não foi possível/i);
  });
});
