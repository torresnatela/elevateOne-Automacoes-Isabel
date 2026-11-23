"use client";

import { useState, type FormEvent } from "react";

/** Trocar a própria senha: a atual e a nova, duas vezes. */
export function ChangePasswordForm() {
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    if (data.get("newPassword") !== data.get("repeat")) {
      setStatus({ error: true, text: "As duas senhas novas não são iguais." });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/account/password", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: data.get("currentPassword"),
          newPassword: data.get("newPassword"),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const details = Object.values((body?.error?.details ?? {}) as Record<string, string[]>);
        setStatus({
          error: true,
          text: details.flat()[0] ?? body?.error?.message ?? "Não foi possível trocar a senha.",
        });
        return;
      }
      form.reset();
      setStatus({ error: false, text: "Senha trocada." });
    } catch {
      setStatus({ error: true, text: "Não foi possível ligar ao servidor. Tente novamente." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="cartao formulario" onSubmit={onSubmit}>
      <h2 className="cartao-titulo">Trocar a senha</h2>

      <div className="campo">
        <label className="campo-rotulo" htmlFor="currentPassword">
          Senha atual
        </label>
        <input
          className="entrada"
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      <div className="campo">
        <label className="campo-rotulo" htmlFor="newPassword">
          Senha nova
        </label>
        <input
          className="entrada"
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          aria-describedby="newPassword-ajuda"
          required
        />
        <span className="ajuda" id="newPassword-ajuda">
          Pelo menos 8 caracteres.
        </span>
      </div>

      <div className="campo">
        <label className="campo-rotulo" htmlFor="repeat">
          Repita a senha nova
        </label>
        <input
          className="entrada"
          id="repeat"
          name="repeat"
          type="password"
          autoComplete="new-password"
          required
        />
      </div>

      {status && (
        <p
          role={status.error ? "alert" : "status"}
          className={status.error ? "mensagem erro" : "mensagem sucesso"}
        >
          {status.text}
        </p>
      )}
      <div>
        <button type="submit" className="botao primario grande" disabled={busy}>
          Trocar senha
        </button>
      </div>
    </form>
  );
}
