"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface GoogleStatusView {
  connected: boolean;
  email: string | null;
  missingScopes: string[];
}

/** O que cada permissão em falta deixa de permitir, por palavras. */
const SCOPE_LABELS: Record<string, string> = {
  "calendar.events": "ver e marcar na agenda",
  "gmail.readonly": "ler emails",
  "gmail.send": "enviar emails",
  "contacts.readonly": "procurar nos contactos",
  "contacts.other.readonly": "procurar nas pessoas com quem trocou emails",
  "drive.readonly": "procurar no Drive",
  "drive.file": "criar documentos",
};

const RESULTS: Record<string, { error: boolean; text: string }> = {
  ligado: { error: false, text: "Conta Google ligada." },
  recusado: { error: true, text: "A autorização foi recusada no Google. Nada foi ligado." },
  erro: { error: true, text: "Não foi possível ligar a conta Google. Tente novamente." },
  "por-configurar": {
    error: true,
    text: "A ligação ao Google ainda não está configurada neste sistema. Fale com o administrador.",
  },
};

const labelOf = (scope: string) => SCOPE_LABELS[scope.split("/auth/")[1] ?? scope] ?? scope;

/** A conta Google de quem está a ver: ligar, ver o que falta, desligar. */
export function GoogleConnection({
  status,
  result,
}: {
  status: GoogleStatusView;
  result?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outcome = result ? RESULTS[result] : undefined;

  async function disconnect() {
    if (
      !window.confirm(
        "Desligar a conta Google? Os agentes deixam de poder usar a agenda e o email.",
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/google", { method: "DELETE" });
      if (!res.ok) throw new Error();
      router.replace("/integracoes");
      router.refresh();
    } catch {
      setError("Não foi possível desligar. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel stack">
      <div>
        <h2>Google</h2>
        <p className="muted">
          Agenda, Gmail, Contactos e Drive. Os agentes agem nesta conta em seu nome, e pedem sempre
          confirmação antes de marcar, enviar ou criar alguma coisa.
        </p>
      </div>

      {outcome && (
        <p role={outcome.error ? "alert" : "status"} className={outcome.error ? "error" : "muted"}>
          {outcome.text}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      {status.connected ? (
        <>
          <p>
            Ligada como <strong>{status.email}</strong>.
          </p>
          {status.missingScopes.length > 0 && (
            <div>
              <p className="error">Faltam permissões. Sem elas, os agentes não conseguem:</p>
              <ul>
                {status.missingScopes.map((scope) => (
                  <li key={scope}>{labelOf(scope)}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="row">
            {status.missingScopes.length > 0 && <a href="/api/google/connect">Dar as permissões</a>}
            <button type="button" className="link danger" disabled={busy} onClick={disconnect}>
              {busy ? "A desligar…" : "Desligar"}
            </button>
          </div>
        </>
      ) : (
        <div>
          <a className="button" href="/api/google/connect">
            Ligar conta Google
          </a>
        </div>
      )}
    </div>
  );
}
