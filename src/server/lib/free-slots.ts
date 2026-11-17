import { fromLocalDateTime, toLocalDateTime } from "./time";

export interface Interval {
  start: Date;
  end: Date;
}

export interface FreeSlotOptions {
  /** O primeiro e o último dia a ver, `AAAA-MM-DD`, no fuso do escritório. */
  fromDay: string;
  toDay: string;
  /** Quanto tem de durar um horário para contar. */
  minutes: number;
  /** O horário de trabalho (horas inteiras, de parede). */
  dayStartHour?: number;
  dayEndHour?: number;
  /** Nada antes deste instante (por norma, agora). */
  notBefore?: Date;
  timeZone?: string;
}

const nextDay = (day: string) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

/**
 * Os intervalos livres dentro do horário de trabalho, de segunda a sexta, entre dois
 * dias: o que sobra depois de tirar os compromissos. Lógica pura.
 */
export function freeSlots(busy: readonly Interval[], options: FreeSlotOptions): Interval[] {
  const {
    fromDay,
    toDay,
    minutes,
    dayStartHour = 9,
    dayEndHour = 18,
    notBefore,
    timeZone,
  } = options;
  const two = (n: number) => String(n).padStart(2, "0");
  const sorted = [...busy].sort((a, b) => a.start.getTime() - b.start.getTime());
  const slots: Interval[] = [];

  for (let day = fromDay, guard = 0; day <= toDay && guard < 62; day = nextDay(day), guard++) {
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;

    const dayEnd = fromLocalDateTime(`${day}T${two(dayEndHour)}:00`, timeZone);
    let cursor = fromLocalDateTime(`${day}T${two(dayStartHour)}:00`, timeZone);
    if (notBefore && notBefore > cursor) cursor = notBefore;

    const add = (end: Date) => {
      if (end.getTime() - cursor.getTime() >= minutes * 60_000) slots.push({ start: cursor, end });
    };
    for (const event of sorted) {
      if (event.end <= cursor || event.start >= dayEnd) continue;
      if (event.start > cursor) add(event.start);
      if (event.end > cursor) cursor = event.end;
    }
    if (cursor < dayEnd) add(dayEnd);
  }
  return slots;
}

/** Um intervalo em horas de parede, para o modelo ler. */
export const describeInterval = (slot: Interval, timeZone?: string) => ({
  inicio: toLocalDateTime(slot.start, timeZone).slice(0, 16),
  fim: toLocalDateTime(slot.end, timeZone).slice(0, 16),
});
