import type { NextRequest } from "next/server";
import { clientMailController } from "@/server/container";

export const runtime = "nodejs";
// Lê vários emails e chama o modelo para cada um: precisa de tempo.
export const maxDuration = 300;

/** O agendamento da Vercel (de hora a hora). Ver vercel.json. */
export function GET(req: NextRequest) {
  return clientMailController.scheduledSync(req);
}

export function POST(req: NextRequest) {
  return clientMailController.scheduledSync(req);
}
