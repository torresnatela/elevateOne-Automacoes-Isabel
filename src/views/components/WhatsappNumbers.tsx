"use client";

import { useState } from "react";

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

  return (
    <tr>
      <td>
        {user.name}
        <br />
        <span className="muted">{user.email}</span>
      </td>
      <td>
        <input
          aria-label={`Número de WhatsApp de ${user.name}`}
          inputMode="tel"
          placeholder="351 912 345 678"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {status && (
          <p role={status.error ? "alert" : "status"} className={status.error ? "error" : "muted"}>
            {status.text}
          </p>
        )}
      </td>
      <td>
        <button type="button" disabled={busy || value.trim() === saved} onClick={save}>
          Guardar
        </button>
      </td>
    </tr>
  );
}

/** Os números de WhatsApp autorizados a falar com o assistente, um por utilizador. */
export function WhatsappNumbers({ users }: { users: UserPhoneView[] }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Utilizador</th>
          <th>Número (com o indicativo do país)</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {users.map((user) => (
          <Row key={user.id} user={user} />
        ))}
      </tbody>
    </table>
  );
}
