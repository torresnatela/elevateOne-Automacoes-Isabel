import type { NextRequest } from "next/server";
import { chatController } from "@/server/container";

export const runtime = "nodejs";

export function GET(req: NextRequest) {
  return chatController.list(req);
}

export function POST(req: NextRequest) {
  return chatController.start(req);
}
