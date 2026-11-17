import { describeInterval, freeSlots } from "@/server/lib/free-slots";
import { describeDateTime, fromLocalDateTime, toLocalDateTime } from "@/server/lib/time";

const utc = (iso: string) => new Date(iso);

describe("horas de Lisboa", () => {
  it("no inverno Lisboa está na hora UTC; no verão, uma hora à frente", () => {
    expect(fromLocalDateTime("2026-11-12T15:00").toISOString()).toBe("2026-11-12T15:00:00.000Z");
    expect(fromLocalDateTime("2026-07-01T15:00").toISOString()).toBe("2026-07-01T14:00:00.000Z");
    expect(toLocalDateTime(utc("2026-07-01T14:00:00Z"))).toBe("2026-07-01T15:00:00");
  });

  it("acerta nos dias em que a hora muda", () => {
    // 29 de março de 2026: à 01:00 passa para as 02:00.
    expect(fromLocalDateTime("2026-03-29T00:30").toISOString()).toBe("2026-03-29T00:30:00.000Z");
    expect(fromLocalDateTime("2026-03-29T03:00").toISOString()).toBe("2026-03-29T02:00:00.000Z");
    // 25 de outubro de 2026: às 02:00 volta para a 01:00.
    expect(fromLocalDateTime("2026-10-25T09:00").toISOString()).toBe("2026-10-25T09:00:00.000Z");
    expect(fromLocalDateTime("2026-10-24T09:00").toISOString()).toBe("2026-10-24T08:00:00.000Z");
  });

  it("serve para outros fusos", () => {
    expect(fromLocalDateTime("2026-11-12T12:00", "America/Sao_Paulo").toISOString()).toBe(
      "2026-11-12T15:00:00.000Z",
    );
  });

  it("recusa o que não é uma data e hora de parede", () => {
    expect(() => fromLocalDateTime("amanhã às 15h")).toThrow();
    expect(() => fromLocalDateTime("2026-11-12T15:00:00Z")).toThrow();
  });

  it("diz a data por extenso, em português", () => {
    expect(describeDateTime(utc("2026-11-12T15:00:00Z"))).toMatch(
      /quinta-feira, 12 de novembro de 2026.*15:00/,
    );
  });
});

describe("freeSlots", () => {
  const busy = (start: string, end: string) => ({
    start: fromLocalDateTime(start),
    end: fromLocalDateTime(end),
  });
  const show = (slots: ReturnType<typeof freeSlots>) => slots.map((s) => describeInterval(s));

  it("um dia sem compromissos está livre das 9 às 18", () => {
    expect(
      show(freeSlots([], { fromDay: "2026-11-12", toDay: "2026-11-12", minutes: 30 })),
    ).toEqual([{ inicio: "2026-11-12T09:00", fim: "2026-11-12T18:00" }]);
  });

  it("tira os compromissos, juntando os que se sobrepõem", () => {
    const slots = freeSlots(
      [
        busy("2026-11-12T10:00", "2026-11-12T11:00"),
        busy("2026-11-12T10:30", "2026-11-12T12:00"),
        busy("2026-11-12T17:00", "2026-11-12T19:00"),
        busy("2026-11-12T07:00", "2026-11-12T08:00"),
      ],
      { fromDay: "2026-11-12", toDay: "2026-11-12", minutes: 30 },
    );
    expect(show(slots)).toEqual([
      { inicio: "2026-11-12T09:00", fim: "2026-11-12T10:00" },
      { inicio: "2026-11-12T12:00", fim: "2026-11-12T17:00" },
    ]);
  });

  it("deixa de fora os intervalos curtos demais", () => {
    const slots = freeSlots([busy("2026-11-12T09:20", "2026-11-12T17:30")], {
      fromDay: "2026-11-12",
      toDay: "2026-11-12",
      minutes: 30,
    });
    expect(show(slots)).toEqual([{ inicio: "2026-11-12T17:30", fim: "2026-11-12T18:00" }]);
  });

  it("salta o fim de semana", () => {
    // 13 de novembro de 2026 é sexta-feira.
    const slots = freeSlots([], { fromDay: "2026-11-13", toDay: "2026-11-16", minutes: 60 });
    expect(show(slots).map((s) => s.inicio.slice(0, 10))).toEqual(["2026-11-13", "2026-11-16"]);
  });

  it("não propõe horas que já passaram", () => {
    const slots = freeSlots([], {
      fromDay: "2026-11-12",
      toDay: "2026-11-12",
      minutes: 30,
      notBefore: fromLocalDateTime("2026-11-12T14:15"),
    });
    expect(show(slots)).toEqual([{ inicio: "2026-11-12T14:15", fim: "2026-11-12T18:00" }]);
  });

  it("um compromisso de dia inteiro ocupa o dia todo", () => {
    const slots = freeSlots([busy("2026-11-12T00:00", "2026-11-13T00:00")], {
      fromDay: "2026-11-12",
      toDay: "2026-11-12",
      minutes: 30,
    });
    expect(slots).toEqual([]);
  });
});
