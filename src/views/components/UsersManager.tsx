"use client";

import { useRef, useState, type FormEvent } from "react";

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
    <div className="stack">
      <form ref={form} className="panel form" onSubmit={create}>
        <label htmlFor="name">Nome</label>
        <input id="name" name="name" required />

        <label htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" required />

        <label htmlFor="password">Senha inicial (pelo menos 8 caracteres)</label>
        <input
          id="password"
          name="password"
          type="password"
          minLength={8}
          required
          autoComplete="new-password"
        />

        <label htmlFor="role">Papel</label>
        <select id="role" name="role" defaultValue="USER">
          <option value="USER">Utilizador</option>
          <option value="ADMIN">Administrador</option>
        </select>

        <button type="submit" disabled={busy}>
          Criar utilizador
        </button>
      </form>

      {status && (
        <p role={status.error ? "alert" : "status"} className={status.error ? "error" : "muted"}>
          {status.text}
        </p>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>E-mail</th>
            <th>Papel</th>
            <th>Estado</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.name}</td>
              <td className="muted">{user.email}</td>
              <td>{user.role === "ADMIN" ? "Administrador" : "Utilizador"}</td>
              <td>{user.active ? "Ativo" : "Desativado"}</td>
              <td>
                <div className="row">
                  <button
                    type="button"
                    className="link"
                    disabled={busy}
                    onClick={() => reset(user)}
                  >
                    Repor senha
                  </button>
                  {user.id !== currentUserId && (
                    <button
                      type="button"
                      className={user.active ? "link danger" : "link"}
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
  );
}
