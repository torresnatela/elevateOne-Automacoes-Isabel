import {
  can,
  hasRole,
  requireRole,
  ForbiddenError,
  UnauthorizedError,
} from "@/server/policies/authorization";
import type { Session } from "@/server/models/session.model";

const admin: Session = { userId: "1", name: "A", email: "a@a.com", role: "ADMIN" };
const user: Session = { userId: "2", name: "U", email: "u@u.com", role: "USER" };

describe("authorization policies", () => {
  it("hasRole: ADMIN herda permissões de USER", () => {
    expect(hasRole(admin, "ADMIN")).toBe(true);
    expect(hasRole(admin, "USER")).toBe(true);
    expect(hasRole(user, "USER")).toBe(true);
    expect(hasRole(user, "ADMIN")).toBe(false);
    expect(hasRole(null, "USER")).toBe(false);
  });

  it("requireRole lança UnauthorizedError sem sessão", () => {
    expect(() => requireRole(null, "USER")).toThrow(UnauthorizedError);
  });

  it("requireRole lança ForbiddenError sem papel suficiente", () => {
    expect(() => requireRole(user, "ADMIN")).toThrow(ForbiddenError);
  });

  it("requireRole devolve a sessão quando autorizado", () => {
    expect(requireRole(admin, "ADMIN")).toBe(admin);
  });

  it("can: verifica ações por papel", () => {
    expect(can(admin, "admin:access")).toBe(true);
    expect(can(user, "admin:access")).toBe(false);
    expect(can(user, "dashboard:view")).toBe(true);
    expect(can(null, "dashboard:view")).toBe(false);
  });
});
