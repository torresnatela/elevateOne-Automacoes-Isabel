import type { NextRequest } from "next/server";
import { googleController } from "@/server/container";

export const runtime = "nodejs";

export function GET(req: NextRequest) {
  return googleController.callback(req);
}
