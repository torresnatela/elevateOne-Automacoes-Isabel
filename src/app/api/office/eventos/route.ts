import type { NextRequest } from "next/server";
import { officeController } from "@/server/container";

export const runtime = "nodejs";

export function GET(req: NextRequest) {
  return officeController.events(req);
}
