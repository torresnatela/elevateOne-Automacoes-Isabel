import type { NextRequest } from "next/server";
import { clientController } from "@/server/container";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return clientController.get(req, (await params).id);
}

export async function PUT(req: NextRequest, { params }: Params) {
  return clientController.update(req, (await params).id);
}
