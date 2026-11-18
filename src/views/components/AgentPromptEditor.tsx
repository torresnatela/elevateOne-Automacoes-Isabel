"use client";

import { useState } from "react";
import { Icon } from "@/views/components/Icon";

export interface AgentPromptView {
  id: string;
  name: string;
  prompt: string;
  defaultPrompt: string;
  customized: boolean;
}

/** As instruções de um agente, para o admin as mudar sem deploy. */
export function AgentPromptEditor({ agent }: { agent: AgentPromptView }) {
  const [saved, setSaved] = useState(agent.prompt);
  const [text, setText] = useState(agent.prompt);
  const [customized, setCustomized] = useState(agent.customized);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);

  async function call(method: "PUT" | "DELETE", next: string) {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/admin/agents/${agent.id}/prompt`, {
        method,
        ...(method === "PUT"
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ prompt: next }),
            }
          : {}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setStatus({ error: true, text: data?.error?.message ?? "Não foi possível guardar." });
        return;
      }
      setSaved(next);
      setText(next);
      setCustomized(method === "PUT");
      setStatus({
        error: false,
        text: method === "PUT" ? "Guardado." : "Instruções de origem repostas.",
      });
    } catch {
      setStatus({ error: true, text: "Não foi possível ligar ao servidor." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cartao formulario">
      <div className="cartao-cabeca">
        <label className="cartao-titulo" htmlFor={`prompt-${agent.id}`} style={{ flex: 1 }}>
          {agent.name}
        </label>
        {customized ? (
          <span className="estado aviso">
            <span className="ponto" />
            <span>Alteradas</span>
          </span>
        ) : (
          <span className="selo">De origem</span>
        )}
      </div>
      <textarea
        className="entrada"
        id={`prompt-${agent.id}`}
        rows={12}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {status && (
        <p
          role={status.error ? "alert" : "status"}
          className={status.error ? "mensagem erro" : "mensagem sucesso"}
        >
          {status.text}
        </p>
      )}
      <div className="linha">
        <button
          type="button"
          className="botao primario"
          disabled={busy || !text.trim() || text === saved}
          onClick={() => call("PUT", text.trim())}
        >
          Guardar
        </button>
        {customized && (
          <button
            type="button"
            className="botao fantasma"
            disabled={busy}
            onClick={() => call("DELETE", agent.defaultPrompt)}
          >
            <Icon name="repor" small />
            Repor as de origem
          </button>
        )}
      </div>
    </div>
  );
}
