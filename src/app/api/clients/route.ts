import type { NextRequest } from "next/server";
import { clientController } from "@/server/container";

export const runtime = "nodejs";

export function GET(req: NextRequest) {
  return clientController.list(req);
}

export function POST(req: NextRequest) {
  return clientController.create(req);
}
