import { loginSchema } from "@/server/validators/auth.schemas";

describe("loginSchema", () => {
  it("aceita e-mail e senha válidos (normalizando o e-mail)", () => {
    const r = loginSchema.safeParse({ email: " Admin@X.com ", password: "123" });
    expect(r.success).toBe(true);
    expect(r.data?.email).toBe("admin@x.com");
  });

  it.each([
    [{}, "payload vazio"],
    [{ email: "nao-e-email", password: "x" }, "e-mail inválido"],
    [{ email: "a@a.com", password: "" }, "senha vazia"],
    [{ email: "a@a.com", password: "x".repeat(201) }, "senha longa demais"],
  ])("rejeita %j (%s)", (input: unknown, _caso: string) => {
    expect(loginSchema.safeParse(input).success).toBe(false);
  });
});
