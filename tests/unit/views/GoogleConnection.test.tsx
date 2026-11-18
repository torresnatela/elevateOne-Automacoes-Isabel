// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { GoogleConnection } from "@/views/components/GoogleConnection";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

describe("<GoogleConnection />", () => {
  it("a quem ligou a conta antes das folhas de cálculo, diz o que falta e como dar a permissão", () => {
    render(
      <GoogleConnection
        status={{
          connected: true,
          email: "rui@escritorio.pt",
          missingScopes: ["https://www.googleapis.com/auth/spreadsheets"],
        }}
      />,
    );

    expect(screen.getByText("ler e escrever em folhas de cálculo")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dar as permissões" })).toHaveAttribute(
      "href",
      "/api/google/connect",
    );
  });

  it("com todas as permissões dadas, não pede nada", () => {
    render(
      <GoogleConnection
        status={{ connected: true, email: "rui@escritorio.pt", missingScopes: [] }}
      />,
    );

    expect(screen.queryByRole("link", { name: "Dar as permissões" })).not.toBeInTheDocument();
  });
});
