import { expect, test, type Page } from "@playwright/test";

const ADMIN = { email: "admin@elevateone.local", password: "Admin@123" };
const USER = { email: "user@elevateone.local", password: "User@1234" };

async function loginAs(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(who.email);
  await page.getByLabel("Senha").fill(who.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("o admin cria um utilizador, que entra e troca a sua senha", async ({ page }) => {
  const email = `ana-${Date.now()}@elevateone.local`;
  await loginAs(page, ADMIN);

  await page.goto("/admin/utilizadores");
  await page.getByLabel("Nome").fill("Ana Teste");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel(/Senha inicial/).fill("Senha-inicial-1");
  await page.getByRole("button", { name: "Criar utilizador" }).click();
  await expect(page.getByRole("status")).toContainText("Ana Teste já pode entrar");
  await expect(page.getByRole("cell", { name: email })).toBeVisible();

  await page.getByRole("button", { name: "Sair" }).click();
  await loginAs(page, { email, password: "Senha-inicial-1" });

  await page.goto("/conta");
  await page.getByLabel("Senha atual").fill("Senha-inicial-1");
  await page.getByLabel(/^Senha nova/).fill("Senha-so-minha-2");
  await page.getByLabel("Repita a senha nova").fill("Senha-so-minha-2");
  await page.getByRole("button", { name: "Trocar senha" }).click();
  await expect(page.getByRole("status")).toHaveText("Senha trocada.");

  await page.getByRole("button", { name: "Sair" }).click();
  await loginAs(page, { email, password: "Senha-so-minha-2" });
});

test("um utilizador desativado deixa de entrar", async ({ page }) => {
  const email = `rui-${Date.now()}@elevateone.local`;
  await loginAs(page, ADMIN);
  await page.goto("/admin/utilizadores");
  await page.getByLabel("Nome").fill("Rui Teste");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel(/Senha inicial/).fill("Senha-do-Rui-1");
  await page.getByRole("button", { name: "Criar utilizador" }).click();
  await expect(page.getByRole("cell", { name: email })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  const row = page.getByRole("row").filter({ hasText: email });
  await row.getByRole("button", { name: "Desativar" }).click();
  await expect(row.getByText("Desativado")).toBeVisible();

  await page.getByRole("button", { name: "Sair" }).click();
  // A página de utilizadores também tem um campo «E-mail»: espera-se pela de login.
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill("Senha-do-Rui-1");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "E-mail ou senha inválidos" }),
  ).toBeVisible();
});

test("o admin vê a base de conhecimento, os agentes e os números de WhatsApp", async ({ page }) => {
  await loginAs(page, ADMIN);

  await page.goto("/admin/conhecimento");
  await expect(page.getByRole("heading", { name: "Base de conhecimento" })).toBeVisible();
  await expect(page.getByLabel(/Assistente interno/)).toBeVisible();
  await expect(page.getByLabel(/Assistente pessoal/)).toBeVisible();

  await page.goto("/admin/whatsapp");
  const phone = page.getByLabel("Número de WhatsApp de Administrador");
  await phone.fill("+351 900 000 123");
  await page
    .getByRole("row")
    .filter({ hasText: ADMIN.email })
    .getByRole("button", { name: "Guardar" })
    .click();
  await expect(page.getByRole("status")).toHaveText("Guardado.");
  await expect(phone).toHaveValue("351900000123");
});

test("um utilizador comum usa o chat e as integrações, mas não as páginas de admin", async ({
  page,
}) => {
  await loginAs(page, USER);

  await page.getByRole("link", { name: "Chat" }).click();
  await expect(page.getByLabel("Mensagem")).toBeVisible();
  await expect(page.getByRole("button", { name: "Nova conversa" })).toBeVisible();

  await page.getByRole("link", { name: "Integrações" }).click();
  await expect(page.getByRole("link", { name: "Ligar conta Google" })).toBeVisible();

  for (const path of ["/admin/utilizadores", "/admin/conhecimento", "/admin/whatsapp"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(403);
  }
  const api = await page.request.get("/api/admin/users");
  expect(api.status()).toBe(403);
});

test("as rotas sem sessão: a saúde responde, os webhooks e a API do escritório exigem o seu segredo", async ({
  request,
}) => {
  expect((await request.get("/api/health")).status()).toBe(200);
  expect((await request.post("/api/webhooks/whatsapp", { data: {} })).status()).not.toBe(200);
  expect((await request.get("/api/office/eventos")).status()).not.toBe(200);
  expect((await request.get("/api/chat/conversations")).status()).toBe(401);
});
