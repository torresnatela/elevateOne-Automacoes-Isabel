import type { NextRequest } from "next/server";
import { clientMailController } from "@/server/container";

export const runtime = "nodejs";

export function GET(req: NextRequest) {
  return clientMailController.exportCsv(req);
}
