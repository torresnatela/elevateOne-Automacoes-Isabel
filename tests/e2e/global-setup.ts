import { execSync } from "node:child_process";

export default function globalSetup() {
  execSync("npx dotenv-cli -e .env.test -- tsx tests/e2e/seed-e2e.ts", { stdio: "inherit" });
}
