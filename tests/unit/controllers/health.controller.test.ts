import { HealthController } from "@/server/controllers/health.controller";

describe("HealthController", () => {
  it("200 quando o banco responde", async () => {
    const res = await new HealthController(async () => 1).check();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("503 quando o banco não responde, sem dizer porquê", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await new HealthController(async () => {
      throw new Error("password authentication failed for user postgres");
    }).check();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
    vi.restoreAllMocks();
  });
});
