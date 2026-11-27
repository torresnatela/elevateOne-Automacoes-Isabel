import type { NextRequest } from "next/server";
import { clientController } from "@/server/container";

export const runtime = "nodejs";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return clientController.setActive(req, (await params).id);
}
