"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/** Aceita apenas caminhos internos para evitar open redirect. */
function safeNext(next?: string) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? "Não foi possível entrar");
        return;
      }
      router.replace(safeNext(next));
      router.refresh();
    } catch {
      setError("Não foi possível conectar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="cartao formulario" onSubmit={onSubmit} noValidate>
      <div className="campo">
        <label className="campo-rotulo" htmlFor="email">
          E-mail
        </label>
        <input
          className="entrada"
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="nome@escritorio.pt"
          required
        />
      </div>

      <div className="campo">
        <label className="campo-rotulo" htmlFor="password">
          Senha
        </label>
        <input
          className="entrada"
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      {error && (
        <p role="alert" className="mensagem erro">
          {error}
        </p>
      )}

      <button type="submit" className="botao primario grande largo" disabled={loading}>
        {loading ? "A entrar…" : "Entrar"}
      </button>
    </form>
  );
}
