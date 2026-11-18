"use client";

import { useState } from "react";
import { initials } from "@/views/lib/initials";

export interface UserPhoneView {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

function Row({ user }: { user: UserPhoneView }) {
  const [saved, setSaved] = useState(user.phone ?? "");
  const [value, setValue] = useState(user.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);
  const dirty = value.trim() !== saved;

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/phone`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: value.trim() || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus({ error: true, text: data?.error?.message ?? "Não foi possível guardar." });
        return;
      }
      const phone = data.phone ?? "";
      setSaved(phone);
      setValue(phone);
      setStatus({ error: false, text: phone ? "Guardado." : "Número retirado." });
    } catch {
      setStatus({ error: true, text: "Não foi possível ligar ao servidor." });
    } finally {
      setBusy(false);
    }
  }

  const state = dirty
    ? { className: "estado aviso", text: "Por guardar" }
    : saved
      ? { className: "estado sucesso", text: "Autorizado" }
      : { className: "estado neutro", text: "Sem número" };

  return (
    <tr>
      <td>
        <span className="pessoa">
          <span className="avatar" aria-hidden="true">
            {initials(user.name)}
          </span>
          <span className="pessoa-textos">
            <span className="forte">{user.name}</span>
            <span className="pessoa-email">{user.email}</span>
          </span>
        </span>
      </td>
      <td>
        <input
          className="entrada numero"
          aria-label={`Número de WhatsApp de ${user.name}`}
          inputMode="tel"
          placeholder="351 912 345 678"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && dirty && !busy) void save();
          }}
        />
        {status && (
          <p
            role={status.error ? "alert" : "status"}
            className={status.error ? "nota-campo erro" : "nota-campo sucesso"}
          >
            {status.text}
          </p>
        )}
      </td>
      <td>
        <span className={state.className}>
          <span className="ponto" />
          <span>{state.text}</span>
        </span>
      </td>
      <td className="acoes">
        <button
          type="button"
          className={dirty ? "botao primario" : "botao secundario"}
          disabled={busy || !dirty}
          onClick={save}
        >
          Guardar
        </button>
      </td>
    </tr>
  );
}

/** Os números de WhatsApp autorizados a falar com o assistente, um por utilizador. */
export function WhatsappNumbers({ users }: { users: UserPhoneView[] }) {
  return (
    <>
      <div className="moldura-tabela">
        <table className="tabela">
          <thead>
            <tr>
              <th>Utilizador</th>
              <th>Número, com o indicativo do país</th>
              <th>Estado</th>
              <th>
                <span className="so-leitor">Guardar</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <Row key={user.id} user={user} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="mensagem nota">Para retirar o acesso de alguém, apague o número e guarde.</p>
    </>
  );
}
