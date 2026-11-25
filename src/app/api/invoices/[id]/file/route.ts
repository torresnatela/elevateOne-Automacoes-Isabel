import type { NextRequest } from "next/server";
import { clientMailController } from "@/server/container";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return clientMailController.invoiceFile(req, (await params).id);
}
