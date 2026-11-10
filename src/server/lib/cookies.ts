import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";
import { SESSION_TTL_SECONDS } from "@/server/models/session.model";

export function sessionCookieOptions(maxAge = SESSION_TTL_SECONDS): Partial<ResponseCookie> {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  };
}
