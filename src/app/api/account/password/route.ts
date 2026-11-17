import type { NextRequest } from "next/server";
import { authController } from "@/server/container";

export const runtime = "nodejs";

export function PUT(req: NextRequest) {
  return authController.changePassword(req);
}
