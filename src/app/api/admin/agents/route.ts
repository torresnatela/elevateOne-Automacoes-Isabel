import type { NextRequest } from "next/server";
import { agentSettingsController } from "@/server/container";

export const runtime = "nodejs";

export function GET(req: NextRequest) {
  return agentSettingsController.list(req);
}
