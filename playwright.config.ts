import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

/** E2E roda contra o banco de teste (.env.test) com o app em modo produção. */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx dotenv-cli -e .env.test -- sh -c "npx prisma migrate deploy && npx next build && npx next start -p ${PORT}"`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
