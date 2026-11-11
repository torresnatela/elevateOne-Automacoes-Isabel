import type { NextRequest } from "next/server";
import { whatsappController } from "@/server/container";

export const runtime = "nodejs";
// A resposta sai logo; o agente trabalha depois, dentro deste limite.
export const maxDuration = 300;

export function POST(req: NextRequest) {
  return whatsappController.webhook(req);
}
