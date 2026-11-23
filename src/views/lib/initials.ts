/** As iniciais de um nome, para o avatar: «Isabel Costa» → «IC», «Isabel» → «IS». */
export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words.at(-1)![0];
  return letters.toUpperCase();
}
