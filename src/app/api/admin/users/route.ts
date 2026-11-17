import type { NextRequest } from "next/server";
import { userAdminController } from "@/server/container";

export const runtime = "nodejs";

export function GET(req: NextRequest) {
  return userAdminController.list(req);
}

export function POST(req: NextRequest) {
  return userAdminController.create(req);
}
