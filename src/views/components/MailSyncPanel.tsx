"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/views/lib/api";

export interface MailboxView {
  mailbox: string;
  lastRunAt: string | null;
  lastError: string | null;
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" }) : "nunca";

/** As caixas Gmail que o agente lê e o botão para o pôr a ler já. */
export function MailSyncPanel({ mailboxes }: { mailboxes: MailboxView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  async function syncNow() {
    setBusy(true);
    setMessage(null);
    try {
      await api("/api/clients/sync", "POST");
      setMessage({
        error: false,
        text: "O agente começou a ler os emails. Os resultados aparecem dentro de uns minutos.",
      });
      setTimeout(() => router.refresh(), 30_000);
    } catch (e) {
      setMessage({ error: true, text: (e as Error).message });
    } finally {
      setBusy(false);
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
        <button type="button" className="botao primario" disabled={busy} onClick={syncNow}>
          Sincronizar agora
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
