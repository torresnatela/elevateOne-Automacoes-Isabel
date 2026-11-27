import {
  CATEGORY_LABELS,
  type ClientEmailRecord,
  type EmailCategory,
} from "@/server/models/client-mail.model";

const gmailLink = (e: ClientEmailRecord) =>
  `https://mail.google.com/mail/?authuser=${encodeURIComponent(e.mailbox)}#all/${e.gmailMessageId}`;

/** Os emails do cliente, do mais recente para trás, com o resumo que o agente fez. */
export function ClientEmailsList({ emails }: { emails: ClientEmailRecord[] }) {
  if (emails.length === 0)
    return (
      <div className="cartao">
        <div className="vazio">
          <p className="vazio-titulo">Ainda sem emails</p>
          <p>O agente de faturas junta aqui, resumido, o que o cliente envia por email.</p>
        </div>
      </div>
    );
  return (
    <div className="cartao">
      <ul className="lista">
        {emails.map((e) => (
          <li key={e.id} className="lista-linha" style={{ alignItems: "flex-start" }}>
            <span className="lista-textos" style={{ gap: 4 }}>
              <span className="linha">
                <span className="lista-titulo">{e.subject}</span>
                <span className="selo">
                  {CATEGORY_LABELS[e.category as EmailCategory] ?? e.category}
                </span>
                {e.actionNeeded && (
                  <span className="estado aviso">
                    <span className="ponto" />
                    <span>Pede resposta</span>
                  </span>
                )}
              </span>
              <span>{e.summary}</span>
              <span className="discreto" style={{ fontSize: 12 }}>
                {e.fromAddress} ·{" "}
                {e.receivedAt.toLocaleString("pt-PT", { dateStyle: "medium", timeStyle: "short" })}
                {e.attachmentCount > 0 && ` · ${e.attachmentCount} anexo(s)`} ·{" "}
                <a href={gmailLink(e)} target="_blank" rel="noreferrer">
                  Abrir no Gmail ({e.mailbox})
                </a>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
