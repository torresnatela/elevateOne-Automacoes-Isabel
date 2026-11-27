"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  ACCOUNTING_REGIMES,
  ACCOUNTING_REGIME_LABELS,
  CLIENT_ENTITY_TYPES,
  ENTITY_TYPE_LABELS,
  VAT_REGIMES,
  VAT_REGIME_LABELS,
  type Client,
} from "@/server/models/client.model";
import { api } from "@/views/lib/api";

export type ClientFormValues = Omit<Client, "createdAt" | "updatedAt">;

/** Uma lista escrita à mão (vírgulas, espaços ou linhas) em itens. */
const splitList = (value: FormDataEntryValue | null) =>
  String(value ?? "")
    .split(/[\s,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);

const text = (value: FormDataEntryValue | null) => String(value ?? "").trim() || null;

/** O formulário de um cliente: cria um novo (sem `client`) ou edita o que recebe. */
export function ClientForm({
  client,
  users,
  isAdmin = false,
}: {
  client?: ClientFormValues;
  users: { id: string; name: string }[];
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);

  async function run(task: () => Promise<string | null>) {
    setBusy(true);
    setStatus(null);
    try {
      const text = await task();
      if (text) setStatus({ error: false, text });
    } catch (e) {
      setStatus({ error: true, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const body = {
      name: data.get("name"),
      tradeName: text(data.get("tradeName")),
      nif: text(data.get("nif")),
      contactEmails: splitList(data.get("contactEmails")),
      emailDomains: splitList(data.get("emailDomains")),
      entityType: data.get("entityType"),
      vatRegime: text(data.get("vatRegime")),
      accountingRegime: text(data.get("accountingRegime")),
      caePrincipal: text(data.get("caePrincipal")),
      niss: text(data.get("niss")),
      address: text(data.get("address")),
      postalCode: text(data.get("postalCode")),
      city: text(data.get("city")),
      country: text(data.get("country")) ?? "PT",
      responsibleUserId: text(data.get("responsibleUserId")),
      notes: text(data.get("notes")),
    };
    void run(async () => {
      if (client) {
        await api(`/api/clients/${client.id}`, "PUT", body);
        router.refresh();
        return "Dados guardados.";
      }
      const { client: created } = await api<{ client: { id: string } }>(
        "/api/clients",
        "POST",
        body,
      );
      router.push(`/clientes/${created.id}`);
      return null;
    });
  }

  function toggleActive() {
    if (!client) return;
    const active = !client.active;
    if (
      !active &&
      !window.confirm(`Desativar ${client.name}? O agente deixa de ler os emails dele.`)
    )
      return;
    void run(async () => {
      await api(`/api/clients/${client.id}/active`, "PUT", { active });
      router.refresh();
      return active ? "Cliente reativado." : "Cliente desativado.";
    });
  }

  const field = (
    id: string,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
    help?: string,
  ) => (
    <div className="campo">
      <label className="campo-rotulo" htmlFor={id}>
        {label}
      </label>
      <input className="entrada" id={id} name={id} {...props} />
      {help && <span className="ajuda">{help}</span>}
    </div>
  );

  return (
    <form className="formulario" onSubmit={submit} style={{ display: "grid", gap: 16 }}>
      <section className="cartao">
        <h2 className="cartao-titulo">Identificação</h2>
        <div className="grelha-campos">
          {field("name", "Nome / denominação", { required: true, defaultValue: client?.name })}
          {field("tradeName", "Nome comercial", { defaultValue: client?.tradeName ?? "" })}
          {field(
            "nif",
            "NIF / NIPC",
            { defaultValue: client?.nif ?? "", inputMode: "numeric", maxLength: 11 },
            "9 dígitos.",
          )}
          <div className="campo">
            <label className="campo-rotulo" htmlFor="entityType">
              Tipo de entidade
            </label>
            <select
              className="entrada"
              id="entityType"
              name="entityType"
              defaultValue={client?.entityType ?? "SOCIEDADE"}
            >
              {CLIENT_ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ENTITY_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="cartao">
        <div style={{ display: "grid", gap: 2 }}>
          <h2 className="cartao-titulo">Emails</h2>
          <p className="cartao-desc">
            É por estes endereços que o agente reconhece os emails (e as faturas) do cliente.
          </p>
        </div>
        <div className="grelha-campos">
          <div className="campo">
            <label className="campo-rotulo" htmlFor="contactEmails">
              Endereços de email
            </label>
            <textarea
              className="entrada"
              id="contactEmails"
              name="contactEmails"
              rows={3}
              defaultValue={client?.contactEmails.join("\n") ?? ""}
              placeholder={"faturas@empresa.pt\ngerencia@empresa.pt"}
            />
            <span className="ajuda">Um por linha.</span>
          </div>
          <div className="campo">
            <label className="campo-rotulo" htmlFor="emailDomains">
              Domínios inteiros (opcional)
            </label>
            <textarea
              className="entrada"
              id="emailDomains"
              name="emailDomains"
              rows={3}
              defaultValue={client?.emailDomains.join("\n") ?? ""}
              placeholder="empresa.pt"
            />
            <span className="ajuda">
              Qualquer remetente deste domínio conta. Não use domínios públicos (gmail.com).
            </span>
          </div>
        </div>
      </section>

      <section className="cartao">
        <h2 className="cartao-titulo">Dados contabilísticos</h2>
        <div className="grelha-campos">
          <div className="campo">
            <label className="campo-rotulo" htmlFor="vatRegime">
              Regime de IVA
            </label>
            <select
              className="entrada"
              id="vatRegime"
              name="vatRegime"
              defaultValue={client?.vatRegime ?? ""}
            >
              <option value="">—</option>
              {VAT_REGIMES.map((t) => (
                <option key={t} value={t}>
                  {VAT_REGIME_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label className="campo-rotulo" htmlFor="accountingRegime">
              Regime de contabilidade
            </label>
            <select
              className="entrada"
              id="accountingRegime"
              name="accountingRegime"
              defaultValue={client?.accountingRegime ?? ""}
            >
              <option value="">—</option>
              {ACCOUNTING_REGIMES.map((t) => (
                <option key={t} value={t}>
                  {ACCOUNTING_REGIME_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          {field(
            "caePrincipal",
            "CAE principal",
            { defaultValue: client?.caePrincipal ?? "", inputMode: "numeric", maxLength: 5 },
            "5 dígitos.",
          )}
          {field(
            "niss",
            "NISS",
            { defaultValue: client?.niss ?? "", inputMode: "numeric", maxLength: 11 },
            "Segurança Social, 11 dígitos.",
          )}
          <div className="campo">
            <label className="campo-rotulo" htmlFor="responsibleUserId">
              Contabilista responsável
            </label>
            <select
              className="entrada"
              id="responsibleUserId"
              name="responsibleUserId"
              defaultValue={client?.responsibleUserId ?? ""}
            >
              <option value="">—</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="cartao">
        <h2 className="cartao-titulo">Morada</h2>
        <div className="grelha-campos">
          {field("address", "Morada", { defaultValue: client?.address ?? "" })}
          {field("postalCode", "Código postal", {
            defaultValue: client?.postalCode ?? "",
            placeholder: "1000-001",
            maxLength: 8,
          })}
          {field("city", "Localidade", { defaultValue: client?.city ?? "" })}
          {field("country", "País", { defaultValue: client?.country ?? "PT", maxLength: 2 })}
        </div>
        <div className="campo">
          <label className="campo-rotulo" htmlFor="notes">
            Notas
          </label>
          <textarea
            className="entrada"
            id="notes"
            name="notes"
            rows={3}
            defaultValue={client?.notes ?? ""}
          />
          <span className="ajuda">
            Não guarde aqui senhas do Portal das Finanças ou da Segurança Social.
          </span>
        </div>
      </section>

      {status && (
        <p
          role={status.error ? "alert" : "status"}
          className={status.error ? "mensagem erro" : "mensagem sucesso"}
        >
          {status.text}
        </p>
      )}

      <div className="linha">
        <button type="submit" className="botao primario grande" disabled={busy}>
          {client ? "Guardar alterações" : "Criar cliente"}
        </button>
        {client && isAdmin && (
          <button
            type="button"
            className={client.active ? "botao fantasma perigo" : "botao fantasma"}
            disabled={busy}
            onClick={toggleActive}
          >
            {client.active ? "Desativar cliente" : "Reativar cliente"}
          </button>
        )}
      </div>
    </form>
  );
}
