import { clientSchema } from "@/server/validators/client.schemas";

describe("clientSchema", () => {
  it("normaliza o NIF, os emails e os domínios, e vazios passam a null", () => {
    const r = clientSchema.parse({
      name: " Empresa X, Lda ",
      nif: "PT 123 456 789",
      contactEmails: ["Faturas@Empresa.pt", "faturas@empresa.pt"],
      emailDomains: ["@Empresa.PT"],
      tradeName: "",
      postalCode: "1000-001",
    });
    expect(r).toMatchObject({
      name: "Empresa X, Lda",
      nif: "123456789",
      contactEmails: ["faturas@empresa.pt"],
      emailDomains: ["empresa.pt"],
      tradeName: null,
      entityType: "SOCIEDADE",
      country: "PT",
    });
  });

  it.each([
    [{ name: "" }, "sem nome"],
    [{ name: "X", nif: "123456788" }, "NIF inválido"],
    [{ name: "X", contactEmails: ["nao-e-email"] }, "email inválido"],
    [{ name: "X", postalCode: "1000" }, "código postal inválido"],
    [{ name: "X", caePrincipal: "12" }, "CAE inválido"],
    [{ name: "X", vatRegime: "OUTRO" }, "regime de IVA desconhecido"],
  ])("rejeita %j (%s)", (input: unknown, _caso: string) => {
    expect(clientSchema.safeParse(input).success).toBe(false);
  });
});
