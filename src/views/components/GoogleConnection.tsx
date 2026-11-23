"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/views/components/Icon";

export interface GoogleStatusView {
  connected: boolean;
  email: string | null;
  missingScopes: string[];
}

/** O que cada permissão deixa fazer, por palavras (as que o sistema pede ao Google). */
const SCOPE_LABELS: Record<string, string> = {
  "calendar.events": "ver e marcar na agenda",
  "gmail.readonly": "ler emails",
  "gmail.send": "enviar emails",
  "contacts.readonly": "procurar nos contactos",
  "contacts.other.readonly": "procurar nas pessoas com quem trocou emails",
  "drive.readonly": "procurar no Drive",
  "drive.file": "criar documentos",
  spreadsheets: "ler e escrever em folhas de cálculo",
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

const keyOf = (scope: string) => scope.split("/auth/")[1] ?? scope;

/** A conta Google de quem está a ver: ligar, ver o que pode e o que falta, desligar. */
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

  const missing = new Set(status.missingScopes.map(keyOf));
  const permissions = [
    ...Object.entries(SCOPE_LABELS).map(([key, label]) => ({
      key,
      label,
      given: !missing.has(key),
    })),
    // (uma permissão que falta e que esta página ainda não sabe dizer por palavras)
    ...[...missing]
      .filter((key) => !(key in SCOPE_LABELS))
      .map((key) => ({ key, label: key, given: false })),
  ];
  const missingCount = permissions.filter((p) => !p.given).length;

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
    <section className="cartao" style={{ gap: 20, padding: 24 }}>
      <div className="cartao-cabeca">
        <span className="ladrilho" aria-hidden="true">
          <Icon name="ligacao" />
        </span>
        <div className="cartao-textos">
          <h2 className="cartao-titulo">Google</h2>
          <p className="cartao-desc">
            {status.connected ? (
              <>
                Ligada como <strong>{status.email}</strong>
              </>
            ) : (
              "Agenda, Gmail, Contactos, Drive e folhas de cálculo."
            )}
          </p>
        </div>
        {status.connected ? (
          <span className={missingCount > 0 ? "estado aviso" : "estado sucesso"}>
            <span className="ponto" />
            <span>{missingCount > 0 ? "Faltam permissões" : "Ligada"}</span>
          </span>
        ) : (
          <span className="estado neutro">
            <span className="ponto" />
            <span>Por ligar</span>
          </span>
        )}
      </div>

      {outcome && (
        <p
          role={outcome.error ? "alert" : "status"}
          className={outcome.error ? "mensagem erro" : "mensagem sucesso"}
        >
          {outcome.text}
        </p>
      )}
      {error && (
        <p role="alert" className="mensagem erro">
          {error}
        </p>
      )}

      {status.connected ? (
        <>
          <div className="campo">
            <h3 className="rotulo">O que os agentes podem fazer nesta conta</h3>
            <ul className="permissoes">
              {permissions.map((p) => (
                <li key={p.key} className={p.given ? undefined : "falta"}>
                  <span className={p.given ? "dada" : undefined}>
                    <Icon name={p.given ? "certo" : "aviso"} small />
                  </span>
                  <span>{p.label}</span>
                  {!p.given && <span className="selo">Em falta</span>}
                </li>
              ))}
            </ul>
          </div>

          {missingCount > 0 && (
            <div className="mensagem aviso cartao-cabeca">
              <span style={{ flex: "1 1 280px" }}>
                {missingCount === 1 ? "Falta uma permissão." : `Faltam ${missingCount} permissões.`}{" "}
                Sem elas, os agentes não conseguem fazer o que está assinalado.
              </span>
              <a className="botao primario" href="/api/google/connect">
                Dar as permissões
              </a>
            </div>
          )}

          <div className="cartao-pe">
            <p className="cartao-desc" style={{ flex: "1 1 320px" }}>
              Os agentes pedem sempre confirmação antes de marcar, enviar, criar ou escrever alguma
              coisa.
            </p>
            <button
              type="button"
              className="botao fantasma perigo"
              disabled={busy}
              onClick={disconnect}
            >
              {busy ? "A desligar…" : "Desligar"}
            </button>
          </div>
        </>
      ) : (
        <div className="cartao-pe">
          <p className="cartao-desc" style={{ flex: "1 1 320px" }}>
            Os agentes agem nesta conta em seu nome, e pedem sempre confirmação antes de marcar,
            enviar, criar ou escrever alguma coisa.
          </p>
          <a className="botao primario grande" href="/api/google/connect">
            Ligar conta Google
          </a>
        </div>
      )}
    </section>
  );
}
