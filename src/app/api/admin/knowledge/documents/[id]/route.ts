import type { NextRequest } from "next/server";
import { knowledgeController } from "@/server/container";

export const runtime = "nodejs";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return knowledgeController.remove(req, (await params).id);
}
