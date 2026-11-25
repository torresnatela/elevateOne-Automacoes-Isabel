"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/views/components/Icon";

export interface ClientRow {
  id: string;
  name: string;
  tradeName: string | null;
  nif: string | null;
  contactEmails: string[];
  emailDomains: string[];
  responsibleName: string | null;
  active: boolean;
}

const norm = (v: string) =>
  v
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** A lista dos clientes, com procura por nome, NIF ou email. */
export function ClientsList({ clients }: { clients: ClientRow[] }) {
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const visible = useMemo(() => {
    const q = norm(query.trim());
    return clients.filter(
      (c) =>
        (showInactive || c.active) &&
        (!q ||
          norm(
            `${c.name} ${c.tradeName ?? ""} ${c.nif ?? ""} ${c.contactEmails.join(" ")}`,
          ).includes(q)),
    );
  }, [clients, query, showInactive]);

  return (
    <>
      <div className="linha">
        <input
          className="entrada"
          style={{ flex: "1 1 260px", maxWidth: 420 }}
          type="search"
          placeholder="Procurar por nome, NIF ou email"
          aria-label="Procurar clientes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="linha discreto">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Mostrar desativados
        </label>
        <span style={{ flex: 1 }} />
        <Link className="botao primario" href="/clientes/novo">
          <Icon name="mais" small />
          Novo cliente
        </Link>
      </div>

      {visible.length === 0 ? (
        <div className="cartao">
          <div className="vazio">
            <span className="ladrilho">
              <Icon name="pessoas" />
            </span>
            <p className="vazio-titulo">
              {clients.length === 0 ? "Ainda não há clientes" : "Nenhum cliente encontrado"}
            </p>
            <p>
              {clients.length === 0
                ? "Registe os clientes com os emails de onde enviam as faturas."
                : "Experimente outra procura."}
            </p>
          </div>
        </div>
      ) : (
        <div className="moldura-tabela">
          <table className="tabela">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>NIF</th>
                <th>Emails</th>
                <th>Responsável</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link className="forte" href={`/clientes/${c.id}`}>
                      {c.name}
                    </Link>
                    {c.tradeName && <div className="discreto">{c.tradeName}</div>}
                  </td>
                  <td>{c.nif ?? "—"}</td>
                  <td>
                    {[...c.contactEmails, ...c.emailDomains.map((d) => `@${d}`)].join(", ") || "—"}
                  </td>
                  <td>{c.responsibleName ?? "—"}</td>
                  <td>
                    <span className={c.active ? "estado sucesso" : "estado neutro"}>
                      <span className="ponto" />
                      <span>{c.active ? "Ativo" : "Desativado"}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
