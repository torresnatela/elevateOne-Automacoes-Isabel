export interface MailboxRun {
  mailbox: string;
  lastRunAt: string | null;
  lastError: string | null;
}

export type SyncOutcome = { ok: true; text: string } | { ok: false; text: string };

/**
 * Como acabou a sincronização, vista do painel quando o trinco já se soltou.
 *
 * Se o pedido daqui começou a corrida (`started`), o trinco foi nosso do princípio ao fim:
 * cada caixa tem de ter uma corrida nova (senão a corrida falhou antes de a ler) e sem erro.
 * Se outra corrida já decorria, não há ponto de partida fiável: conta só se ficaram erros.
 */
export function syncOutcome(
  started: boolean,
  before: MailboxRun[],
  after: MailboxRun[],
  /** O trinco expirou sem se soltar: a corrida não acabou bem nem gravou o resultado. */
  abandoned = false,
): SyncOutcome {
  if (abandoned)
    return {
      ok: false,
      text: "A corrida não terminou bem e não foi possível confirmar o resultado. Tente de novo daqui a pouco.",
    };
  const previous = new Map(before.map((m) => [m.mailbox, m.lastRunAt]));
  const unread = started
    ? after.filter((m) => m.lastRunAt === null || m.lastRunAt === previous.get(m.mailbox))
    : [];
  if (unread.length)
    return {
      ok: false,
      text: `A sincronização terminou sem ler ${unread.map((m) => m.mailbox).join(", ")}. Tente de novo daqui a pouco.`,
    };
  const failed = after.filter((m) => m.lastError);
  if (failed.length)
    return {
      ok: false,
      text: `A sincronização terminou com erros em ${failed.map((m) => m.mailbox).join(", ")}: veja o estado abaixo.`,
    };
  return { ok: true, text: "Sincronização concluída." };
}
