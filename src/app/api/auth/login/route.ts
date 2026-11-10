import type { NextRequest } from "next/server";
import { authController } from "@/server/container";

export const runtime = "nodejs";

export function POST(req: NextRequest) {
  return authController.login(req);
}
