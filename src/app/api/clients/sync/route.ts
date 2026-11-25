import type { NextRequest } from "next/server";
import { clientMailController } from "@/server/container";

export const runtime = "nodejs";
export const maxDuration = 300;

export function GET(req: NextRequest) {
  return clientMailController.status(req);
}

export function POST(req: NextRequest) {
  return clientMailController.syncNow(req);
}
