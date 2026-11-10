import { execSync } from "node:child_process";
import { config } from "dotenv";

/** Aplica as migrations no banco de teste antes da suíte de integração. */
export default function setup() {
  const { parsed } = config({ path: ".env.test", override: true, quiet: true });
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, ...parsed },
  });
}
