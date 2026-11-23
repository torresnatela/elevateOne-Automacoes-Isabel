"use client";

import { useRef, useState, type FormEvent } from "react";
import { initials } from "@/views/lib/initials";

export interface UserView {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "USER";
  active: boolean;
}

const CONNECTION_ERROR = "Não foi possível ligar ao servidor. Tente novamente.";

/** Chama a API e devolve os dados, ou lança a mensagem de erro que ela deu. */
async function api<T>(url: string, method: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(CONNECTION_ERROR);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const details = Object.values((data?.error?.details ?? {}) as Record<string, string[]>).flat();
    throw new Error(details[0] ?? data?.error?.message ?? "Algo correu mal.");
  }
  return data as T;
}

/** Os utilizadores, para o admin: criar, ativar e desativar, repor a senha. */
export function UsersManager({
  initialUsers,
  currentUserId,
}: {
  initialUsers: UserView[];
  currentUserId: string;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  async function run(task: () => Promise<string>) {
    setBusy(true);
    setStatus(null);
    try {
      setStatus({ error: false, text: await task() });
    } catch (e) {
      setStatus({ error: true, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    void run(async () => {
      const { user } = await api<{ user: UserView }>("/api/admin/users", "POST", {
        name: data.get("name"),
        email: data.get("email"),
        password: data.get("password"),
        role: data.get("role"),
      });
      setUsers((list) => [...list, user].sort((a, b) => a.name.localeCompare(b.name)));
      form.current?.reset();
      return `${user.name} já pode entrar com o e-mail e a senha que definiu.`;
    });
  }

  function toggle(user: UserView) {
    const active = !user.active;
    if (!active && !window.confirm(`Desativar ${user.name}? Deixa de conseguir entrar.`)) return;
    void run(async () => {
      await api(`/api/admin/users/${user.id}/active`, "PUT", { active });
      setUsers((list) => list.map((u) => (u.id === user.id ? { ...u, active } : u)));
      return active ? `${user.name} voltou a ter acesso.` : `${user.name} ficou sem acesso.`;
    });
  }

  function reset(user: UserView) {
    const password = window.prompt(`A senha nova de ${user.name} (pelo menos 8 caracteres):`);
    if (!password) return;
    void run(async () => {
      await api(`/api/admin/users/${user.id}/password`, "PUT", { password });
      return `A senha de ${user.name} foi trocada. Diga-lha por um meio seguro.`;
    });
  }

  return (
    <>
      <form ref={form} className="cartao formulario" onSubmit={create}>
        <div className="pagina-cabeca" style={{ gap: 2 }}>
          <h2 className="cartao-titulo">Novo utilizador</h2>
          <p className="cartao-desc">Entra com o e-mail e a senha que definir aqui.</p>
        </div>

        <div className="grelha-campos">
          <div className="campo">
            <label className="campo-rotulo" htmlFor="name">
              Nome
            </label>
            <input className="entrada" id="name" name="name" required />
          </div>

          <div className="campo">
            <label className="campo-rotulo" htmlFor="email">
              E-mail
            </label>
            <input className="entrada" id="email" name="email" type="email" required />
          </div>

          <div className="campo">
            <label className="campo-rotulo" htmlFor="password">
              Senha inicial
            </label>
            <input
              className="entrada"
              id="password"
              name="password"
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
              aria-describedby="password-ajuda"
            />
            <span className="ajuda" id="password-ajuda">
              Pelo menos 8 caracteres.
            </span>
          </div>

          <div className="campo">
            <label className="campo-rotulo" htmlFor="role">
              Papel
            </label>
            <select className="entrada" id="role" name="role" defaultValue="USER">
              <option value="USER">Utilizador</option>
              <option value="ADMIN">Administrador</option>
            </select>
          </div>
        </div>

        <div>
          <button type="submit" className="botao primario grande" disabled={busy}>
            Criar utilizador
          </button>
        </div>
      </form>

      {status && (
        <p
          role={status.error ? "alert" : "status"}
          className={status.error ? "mensagem erro" : "mensagem sucesso"}
        >
          {status.text}
        </p>
      )}

      <div className="moldura-tabela">
        <table className="tabela">
          <thead>
            <tr>
              <th>Nome</th>
              <th>E-mail</th>
              <th>Papel</th>
              <th>Estado</th>
              <th>
                <span className="so-leitor">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <span className="pessoa forte">
                    <span className={user.active ? "avatar" : "avatar apagado"} aria-hidden="true">
                      {initials(user.name)}
                    </span>
                    {user.name}
                  </span>
                </td>
                <td>{user.email}</td>
                <td>{user.role === "ADMIN" ? "Administrador" : "Utilizador"}</td>
                <td>
                  <span className={user.active ? "estado sucesso" : "estado neutro"}>
                    <span className="ponto" />
                    <span>{user.active ? "Ativo" : "Desativado"}</span>
                  </span>
                </td>
                <td className="acoes">
                  <div className="linha">
                    <button
                      type="button"
                      className="botao fantasma"
                      disabled={busy}
                      onClick={() => reset(user)}
                    >
                      Repor senha
                    </button>
                    {user.id !== currentUserId && (
                      <button
                        type="button"
                        className={user.active ? "botao fantasma perigo" : "botao fantasma"}
                        disabled={busy}
                        onClick={() => toggle(user)}
                      >
                        {user.active ? "Desativar" : "Reativar"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
