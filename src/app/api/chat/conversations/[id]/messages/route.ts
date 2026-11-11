import type { NextRequest } from "next/server";
import { chatController } from "@/server/container";

export const runtime = "nodejs";
// O agente pode procurar várias vezes antes de responder.
export const maxDuration = 300;

type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Context) {
  return chatController.messages(req, (await params).id);
}

export async function POST(req: NextRequest, { params }: Context) {
  return chatController.send(req, (await params).id);
}
