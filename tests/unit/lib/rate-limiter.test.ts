import { RateLimiter } from "@/server/lib/rate-limiter";

function setup() {
  const clock = { now: 1_000_000 };
  return { clock, limiter: new RateLimiter(3, 60_000, () => clock.now) };
}

describe("RateLimiter", () => {
  it("deixa tentar até ao máximo de falhas, e depois trava", () => {
    const { limiter } = setup();
    limiter.fail("a");
    limiter.fail("a");
    expect(limiter.retryAfterSeconds("a")).toBe(0);
    limiter.fail("a");
    expect(limiter.retryAfterSeconds("a")).toBe(60);
  });

  it("destrava quando a janela passa", () => {
    const { limiter, clock } = setup();
    for (let i = 0; i < 3; i++) limiter.fail("a");
    clock.now += 59_000;
    expect(limiter.retryAfterSeconds("a")).toBe(1);
    clock.now += 1_000;
    expect(limiter.retryAfterSeconds("a")).toBe(0);
  });

  it("cada chave conta por si, e um sucesso limpa as falhas", () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i++) limiter.fail("a");
    expect(limiter.retryAfterSeconds("b")).toBe(0);
    limiter.reset("a");
    expect(limiter.retryAfterSeconds("a")).toBe(0);
  });
});
