import type { NextRequest } from "next/server";
import { authController } from "@/server/container";

export const runtime = "nodejs";

export function GET(req: NextRequest) {
  return authController.me(req);
}
