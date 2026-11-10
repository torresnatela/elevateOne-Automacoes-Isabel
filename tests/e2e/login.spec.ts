import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string, password: string) {
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

test("rota protegida sem sessão redireciona para /login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
});

test("credenciais inválidas exibem erro", async ({ page }) => {
  await page.goto("/login");
  await login(page, "admin@elevateone.local", "senha-errada");
  await expect(
    page.getByRole("alert").filter({ hasText: "E-mail ou senha inválidos" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("usuário padrão faz login, acessa admin e sai", async ({ page }) => {
  await page.goto("/login");
  await login(page, "admin@elevateone.local", "Admin@123");

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Olá, Administrador" })).toBeVisible();

  await page.getByRole("link", { name: "Admin" }).click();
  await expect(page.getByRole("heading", { name: "Administração" })).toBeVisible();

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("usuário comum não acessa /admin (403)", async ({ page }) => {
  await page.goto("/login");
  await login(page, "user@elevateone.local", "User@1234");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);

  const res = await page.goto("/admin");
  expect(res?.status()).toBe(403);
  await expect(page.getByRole("heading", { name: /Acesso negado/ })).toBeVisible();
});
