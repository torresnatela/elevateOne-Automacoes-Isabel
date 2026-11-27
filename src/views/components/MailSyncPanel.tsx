"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/views/lib/api";

export interface MailboxView {
  mailbox: string;
  lastRunAt: string | null;
  lastError: string | null;
}

/** De quanto em quanto tempo se pergunta se a sincronização acabou, e até quando. */
const POLL_MS = 10_000;
const POLL_MAX_MS = 6 * 60_000;

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" }) : "nunca";

/** As caixas Gmail que o agente lê e o botão para o pôr a ler já. */
export function MailSyncPanel({ mailboxes }: { mailboxes: MailboxView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // À espera do fim da corrida pedida: o botão fica parado, para um segundo pedido não trocar
  // o ponto de partida da espera (o servidor recusava-o na mesma: só corre uma de cada vez).
  const [waiting, setWaiting] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ao sair da página, deixa de perguntar: um pedido que ainda estava a caminho, ao voltar,
  // vê a marca e não agenda outro nem mexe na página.
  const gone = useRef(false);
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  /**
   * Pergunta até não haver corrida a decorrer (ou o tempo acabar), e atualiza a página. O botão
   * fica com o trinco antes de o servidor responder, por isso, depois do pedido, «a decorrer» é
   * exatamente a corrida pedida — ou a que já estava a correr e fez recusar o pedido.
   */
  function waitForRun(startedAt: number) {
    timer.current = setTimeout(async () => {
      if (gone.current) return;
      let finished = false;
      try {
        const { running } = await api<{ running: boolean }>("/api/clients/sync", "GET");
        finished = !running;
      } catch {
        // Uma falha de rede numa pergunta não para a espera.
      }
      if (gone.current) return;
      if (finished) {
        setWaiting(false);
        setMessage({ error: false, text: "Sincronização concluída." });
        router.refresh();
        return;
      }
      // Passou o tempo sem se ver o fim: não se diz que acabou.
      if (Date.now() - startedAt > POLL_MAX_MS) {
        setWaiting(false);
        setMessage({
          error: true,
          text: "Não foi possível confirmar que a sincronização acabou. Atualize a página daqui a pouco.",
        });
        router.refresh();
        return;
      }
      waitForRun(startedAt);
    }, POLL_MS);
  }

  async function syncNow() {
    setBusy(true);
    setMessage(null);
    try {
      // As caixas ligadas agora, não as de quando a página abriu.
      const { mailboxes: current } = await api<{ mailboxes: MailboxView[] }>(
        "/api/clients/sync",
        "GET",
      );
      // Saiu-se da página enquanto se esperava: não se pede a corrida nem se mexe em nada.
      if (gone.current) return;
      // Sem caixas ligadas não há corrida para ver acabar: não se diz que sincronizou.
      if (current.length === 0) {
        setMessage({
          error: true,
          text: "Não há contas Google ligadas. Ligue uma em Integrações para o agente ler os emails.",
        });
        return;
      }
      const { started } = await api<{ started: boolean }>("/api/clients/sync", "POST");
      if (gone.current) return;
      setMessage({
        error: false,
        text: started
          ? "O agente começou a ler os emails. A página atualiza-se quando acabar."
          : "O agente já estava a ler os emails. A página atualiza-se quando acabar.",
      });
      if (timer.current) clearTimeout(timer.current);
      setWaiting(true);
      waitForRun(Date.now());
    } catch (e) {
      if (!gone.current) setMessage({ error: true, text: (e as Error).message });
    } finally {
      if (!gone.current) setBusy(false);
    }
  }

  return (
    <section className="cartao">
      <div className="cartao-cabeca">
        <div className="cartao-textos">
          <h2 className="cartao-titulo">Agente de faturas</h2>
          <p className="cartao-desc">
            Lê, de hora a hora, os emails dos clientes nas contas Google ligadas em Integrações.
          </p>
        </div>
        <button
          type="button"
          className="botao primario"
          disabled={busy || waiting || mailboxes.length === 0}
          onClick={syncNow}
        >
          {waiting ? "A sincronizar…" : "Sincronizar agora"}
        </button>
      </div>
      {mailboxes.length === 0 ? (
        <p className="mensagem aviso">
          Ninguém ligou ainda uma conta Google. Ligue-a em Integrações para o agente ler os emails.
        </p>
      ) : (
        <ul className="lista">
          {mailboxes.map((m) => (
            <li key={m.mailbox} className="lista-linha">
              <span className="lista-textos">
                <span className="lista-titulo">{m.mailbox}</span>
                <span className="lista-desc">
                  {m.lastError
                    ? `Erro: ${m.lastError}`
                    : `Lida pela última vez: ${when(m.lastRunAt)}`}
                </span>
              </span>
              <span className={m.lastError ? "estado ajuda" : "estado sucesso"}>
                <span className="ponto" />
                <span>{m.lastError ? "Com erro" : "OK"}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p
          role={message.error ? "alert" : "status"}
          className={message.error ? "mensagem erro" : "mensagem sucesso"}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
