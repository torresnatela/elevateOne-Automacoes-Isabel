import { healthController } from "@/server/container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return healthController.check();
}
