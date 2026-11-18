/**
 * Onde cortar um texto para ficar com `end` caracteres no máximo, sem partir a meio um
 * carácter de dois códigos (um emoji): metade dele é texto que a base de dados recusa guardar.
 */
export function cutPoint(text: string, end: number): number {
  if (end >= text.length) return text.length;
  if (end <= 0) return 0;
  const code = text.charCodeAt(end - 1);
  return code >= 0xd800 && code <= 0xdbff ? end - 1 : end;
}
