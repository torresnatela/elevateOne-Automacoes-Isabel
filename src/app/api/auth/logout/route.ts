import { authController } from "@/server/container";

export const runtime = "nodejs";

export function POST() {
  return authController.logout();
}
