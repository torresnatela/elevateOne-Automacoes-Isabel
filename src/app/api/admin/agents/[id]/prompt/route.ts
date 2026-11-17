import type { NextRequest } from "next/server";
import { agentSettingsController } from "@/server/container";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Context) {
  return agentSettingsController.setPrompt(req, (await params).id);
}

export async function DELETE(req: NextRequest, { params }: Context) {
  return agentSettingsController.resetPrompt(req, (await params).id);
}
