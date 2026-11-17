import type { NextRequest } from "next/server";
import { userAdminController } from "@/server/container";

export const runtime = "nodejs";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return userAdminController.resetPassword(req, (await params).id);
}
