import { chunkText } from "@/server/lib/chunk";

describe("chunkText", () => {
  it("devolve nada para um texto vazio", () => {
    expect(chunkText("  \n\n \t ")).toEqual([]);
  });

  it("deixa um texto curto num só pedaço, com os espaços arrumados", () => {
    expect(chunkText("O IVA   normal\r\né 23 %.\n\n\n\nNas ilhas é menos.")).toEqual([
      "O IVA normal\né 23 %.\n\nNas ilhas é menos.",
    ]);
  });

  it("junta parágrafos inteiros até ao tamanho", () => {
    const chunks = chunkText("aaaa aaaa\n\nbbbb bbbb\n\ncccc cccc", { size: 20, overlap: 0 });
    expect(chunks).toEqual(["aaaa aaaa\n\nbbbb bbbb", "cccc cccc"]);
  });

  it("nunca passa do tamanho", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Parágrafo ${i} com algum texto.`).join(
      "\n\n",
    );
    for (const chunk of chunkText(text, { size: 120, overlap: 30 })) {
      expect(chunk.length).toBeLessThanOrEqual(120);
    }
  });

  it("começa cada pedaço com o fim do anterior, em palavras inteiras", () => {
    const chunks = chunkText("um dois três quatro\n\ncinco seis sete oito", {
      size: 30,
      overlap: 8,
    });
    expect(chunks).toEqual(["um dois três quatro", "quatro\n\ncinco seis sete oito"]);
  });

  it("parte por frases um parágrafo maior do que o tamanho", () => {
    const chunks = chunkText("Primeira frase aqui. Segunda frase aqui. Terceira frase aqui.", {
      size: 45,
      overlap: 0,
    });
    expect(chunks).toEqual(["Primeira frase aqui. Segunda frase aqui.", "Terceira frase aqui."]);
  });

  it("corta a direito uma frase sem pausas maior do que o tamanho", () => {
    const chunks = chunkText("x".repeat(25), { size: 10, overlap: 0 });
    expect(chunks.map((c) => c.length)).toEqual([10, 10, 5]);
  });

  it("não perde texto", () => {
    const words = Array.from({ length: 300 }, (_, i) => `palavra${i}`);
    const joined = chunkText(words.join(" "), { size: 200, overlap: 0 }).join(" ");
    expect(joined.split(/\s+/)).toEqual(words);
  });
});
