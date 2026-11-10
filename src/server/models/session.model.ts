import type { Role } from "./user.model";

export const SESSION_COOKIE = "eo_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 horas

export interface Session {
  userId: string;
  name: string;
  email: string;
  role: Role;
}
