/** O fuso do escritório: as horas que os agentes dizem e ouvem são as de Lisboa. */
export const OFFICE_TIME_ZONE = "Europe/Lisbon";

/** Uma data e hora «de parede», sem fuso: `2026-11-12T15:00` (os segundos são opcionais). */
export const LOCAL_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

const partsIn = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
};

/** A hora de parede de um instante num fuso: `2026-11-12T15:00:00`. */
export function toLocalDateTime(date: Date, timeZone = OFFICE_TIME_ZONE): string {
  const p = partsIn(date, timeZone);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}:${two(p.second)}`;
}

/**
 * O instante de uma hora de parede num fuso (com a hora de verão certa). Uma hora que
 * não existe (o salto da primavera) cai na hora seguinte; uma que existe duas vezes
 * (o recuo do outono), na primeira.
 */
export function fromLocalDateTime(local: string, timeZone = OFFICE_TIME_ZONE): Date {
  if (!LOCAL_DATE_TIME_RE.test(local)) throw new Error(`Data e hora inválidas: ${local}`);
  const wall = Date.parse(`${local.length === 16 ? `${local}:00` : local}Z`);
  // A diferença do fuso depende do instante: acerta-se em duas voltas.
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const shown = Date.parse(`${toLocalDateTime(new Date(guess), timeZone)}Z`);
    guess += wall - shown;
  }
  return new Date(guess);
}

/** Como se diz a alguém: «quinta-feira, 12 de novembro de 2026, 15:00». */
export function describeDateTime(date: Date, timeZone = OFFICE_TIME_ZONE): string {
  return new Intl.DateTimeFormat("pt-PT", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
