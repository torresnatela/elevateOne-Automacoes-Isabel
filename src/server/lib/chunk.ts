export interface ChunkOptions {
  /** O tamanho máximo de um pedaço, em caracteres. */
  size?: number;
  /** Quanto do fim de um pedaço se repete no início do seguinte, para não cortar o contexto. */
  overlap?: number;
}

/** O fim de um texto, até `length` caracteres, a começar numa palavra inteira. */
function tail(text: string, length: number): string {
  if (length <= 0 || text.length <= length) return length <= 0 ? "" : text;
  const cut = text.slice(-length);
  const space = cut.search(/\s/);
  return space === -1 ? "" : cut.slice(space + 1).trim();
}

/** Junta unidades (frases, palavras) com um espaço até ao tamanho; as que não cabem partem-se com `split`. */
function pack(units: string[], size: number, split: (unit: string) => string[]): string[] {
  const parts: string[] = [];
  let current = "";
  const flush = () => {
    if (current) parts.push(current);
    current = "";
  };
  for (const unit of units) {
    if (unit.length > size) {
      flush();
      parts.push(...split(unit));
      continue;
    }
    if (current && current.length + 1 + unit.length > size) flush();
    current = current ? `${current} ${unit}` : unit;
  }
  flush();
  return parts;
}

const cut = (word: string, size: number) =>
  Array.from({ length: Math.ceil(word.length / size) }, (_, i) =>
    word.slice(i * size, (i + 1) * size),
  );

const byWords = (sentence: string, size: number) =>
  pack(sentence.split(/\s+/), size, (word) => cut(word, size));

/** Parte um parágrafo maior do que `size`: por frases, depois por palavras e, por fim, a direito. */
function splitLong(paragraph: string, size: number): string[] {
  if (paragraph.length <= size) return [paragraph];
  return pack(paragraph.split(/(?<=[.!?;:])\s+/), size, (sentence) => byWords(sentence, size));
}

/**
 * Parte um texto em pedaços para a procura na base de conhecimento: junta parágrafos inteiros
 * até ao tamanho, e cada pedaço começa com o fim do anterior. Lógica pura.
 */
export function chunkText(
  text: string,
  { size = 1200, overlap = 200 }: ChunkOptions = {},
): string[] {
  const clean = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!clean) return [];

  const pieces = clean
    .split("\n\n")
    .flatMap((p) => splitLong(p.trim(), size))
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + 2 + piece.length > size) {
      chunks.push(current);
      current = tail(current, overlap);
      if (current.length + 2 + piece.length > size) current = "";
    }
    current = current ? `${current}\n\n${piece}` : piece;
  }
  if (current) chunks.push(current);
  return chunks;
}
