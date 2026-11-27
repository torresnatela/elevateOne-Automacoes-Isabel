import { syncOutcome } from "@/views/lib/sync-outcome";

const box = (mailbox: string, lastRunAt: string | null, lastError: string | null = null) => ({
  mailbox,
  lastRunAt,
  lastError,
});

describe("syncOutcome", () => {
  it("a corrida pedida aqui leu todas as caixas sem erro: concluída", () => {
    expect(
      syncOutcome(
        true,
        [box("a@x.pt", "t1"), box("b@x.pt", null)],
        [box("a@x.pt", "t2"), box("b@x.pt", "t2")],
      ),
    ).toEqual({ ok: true, text: "Sincronização concluída." });
  });

  it("a corrida pedida aqui falhou antes de ler uma caixa: não se diz que concluiu", () => {
    const outcome = syncOutcome(
      true,
      [box("a@x.pt", "t1"), box("b@x.pt", "t1")],
      [box("a@x.pt", "t2"), box("b@x.pt", "t1")],
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toContain("sem ler b@x.pt");
  });

  it("a corrida falhou antes de ler qualquer caixa (nenhuma data mudou)", () => {
    expect(syncOutcome(true, [box("a@x.pt", "t1")], [box("a@x.pt", "t1")]).ok).toBe(false);
  });

  it("uma caixa terminou com erro", () => {
    const outcome = syncOutcome(true, [box("a@x.pt", "t1")], [box("a@x.pt", "t2", "expirou")]);
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toContain("com erros em a@x.pt");
  });

  it("outra corrida já decorria e falhou antes de ler: o erro que ela gravou aparece", () => {
    const outcome = syncOutcome(
      false,
      [box("a@x.pt", "t1")],
      [box("a@x.pt", "t1", "A corrida falhou: base em baixo")],
    );
    expect(outcome.ok).toBe(false);
  });

  it("outra corrida já decorria: sem ponto de partida, conta só se ficaram erros", () => {
    expect(syncOutcome(false, [box("a@x.pt", "t1")], [box("a@x.pt", "t1")]).ok).toBe(true);
    expect(syncOutcome(false, [box("a@x.pt", "t1")], [box("a@x.pt", "t2", "x")]).ok).toBe(false);
  });

  it("um trinco que expirou sem se soltar nunca dá «concluída», mesmo sem erros nas caixas", () => {
    const outcome = syncOutcome(false, [box("a@x.pt", "t1")], [box("a@x.pt", "t1")], true);
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toContain("não foi possível confirmar");
  });
});
