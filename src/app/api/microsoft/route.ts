import type { NextRequest } from "next/server";
import { microsoftController } from "@/server/container";

export const runtime = "nodejs";

export function GET(req: NextRequest) {
  return microsoftController.status(req);
}

export function DELETE(req: NextRequest) {
  return microsoftController.disconnect(req);
}
