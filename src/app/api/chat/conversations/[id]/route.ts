import type { NextRequest } from "next/server";
import { chatController } from "@/server/container";

export const runtime = "nodejs";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return chatController.remove(req, (await params).id);
}
