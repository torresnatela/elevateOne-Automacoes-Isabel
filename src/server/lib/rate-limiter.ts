/**
 * Conta as tentativas falhadas por chave numa janela de tempo, na memória do processo
 * (chega para uma só instância da app). Depois de `max` falhas, a chave fica bloqueada
 * até a janela passar.
 */
export class RateLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const since = this.now() - this.windowMs;
    const recent = (this.failures.get(key) ?? []).filter((at) => at > since);
    if (recent.length) this.failures.set(key, recent);
    else this.failures.delete(key);
    return recent;
  }

  /** Quantos segundos falta esperar, ou 0 se pode tentar. */
  retryAfterSeconds(key: string): number {
    const recent = this.recent(key);
    if (recent.length < this.max) return 0;
    return Math.max(1, Math.ceil((recent[0] + this.windowMs - this.now()) / 1000));
  }

  fail(key: string): void {
    this.failures.set(key, [...this.recent(key), this.now()]);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}
