import type { NextRequest } from "next/server";
import { clientMailController } from "@/server/container";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return clientMailController.updateInvoice(req, (await params).id);
}
