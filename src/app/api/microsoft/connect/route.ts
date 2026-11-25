import type { NextRequest } from "next/server";
import { microsoftController } from "@/server/container";

export const runtime = "nodejs";

export function GET(req: NextRequest) {
  return microsoftController.connect(req);
}
