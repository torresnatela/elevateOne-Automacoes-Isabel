import { domainOf, isValidNif, normalizeNif } from "@/server/models/client.model";

describe("isValidNif", () => {
  it.each(["123456789", "500000000", "501964843"])("aceita %s", (nif) => {
    expect(isValidNif(nif)).toBe(true);
  });

  it.each([
    ["123456788", "dígito de controlo errado"],
    ["12345678", "8 dígitos"],
    ["40000000x", "não numérico"],
    ["400000000", "prefixo não atribuído"],
  ])("rejeita %s (%s)", (nif) => {
    expect(isValidNif(nif)).toBe(false);
  });
});

it("normalizeNif tira o prefixo do país e a pontuação", () => {
  expect(normalizeNif("PT 123.456.789")).toBe("123456789");
});

it("domainOf devolve o domínio em minúsculas", () => {
  expect(domainOf("Ana@Empresa.PT")).toBe("empresa.pt");
});
