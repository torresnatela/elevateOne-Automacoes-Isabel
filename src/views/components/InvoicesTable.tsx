"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  DOC_TYPE_LABELS,
  INVOICE_DOC_TYPES,
  STATUS_LABELS,
  type InvoiceRecord,
  type InvoiceStatus,
} from "@/server/models/client-mail.model";
import { api } from "@/views/lib/api";

export type InvoiceView = Omit<InvoiceRecord, "receivedAt"> & { receivedAt: string };

const STATUS_CLASS: Record<InvoiceStatus, string> = {
  EXTRAIDA: "estado trabalho",
  A_REVER: "estado aviso",
  CONFIRMADA: "estado sucesso",
  REJEITADA: "estado neutro",
};

const money = (n: number | null, currency: string) =>
  n === null ? "—" : n.toLocaleString("pt-PT", { style: "currency", currency });

const numberOrNull = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "")
    .trim()
    .replace(",", ".");
  return s === "" ? null : Number(s);
};
const textOrNull = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null;

/** As faturas que o agente extraiu: abrir o ficheiro, corrigir, confirmar ou rejeitar. */
export function InvoicesTable({
  initialInvoices,
  showClient = false,
}: {
  initialInvoices: InvoiceView[];
  showClient?: boolean;
}) {
  const [invoices, setInvoices] = useState(initialInvoices);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);

  // Depois de um `router.refresh()` (nova sincronização), a lista do servidor substitui a de cá;
  // a fatura que está a ser revista mantém-se aberta.
  useEffect(() => setInvoices(initialInvoices), [initialInvoices]);

  async function patch(id: string, body: Record<string, unknown>, done: string) {
    setBusy(true);
    setStatus(null);
    try {
      const { invoice } = await api<{ invoice: InvoiceRecord }>(
        `/api/invoices/${id}`,
        "PATCH",
        body,
      );
      setInvoices((list) =>
        list.map((i) => (i.id === id ? { ...invoice, receivedAt: String(invoice.receivedAt) } : i)),
      );
      setEditing(null);
      setStatus({ error: false, text: done });
    } catch (e) {
      setStatus({ error: true, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  /** Guarda as correções do formulário; com «Confirmar» ou «Rejeitar», muda também o estado. */
  function save(e: FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const nextStatus = submitter?.value as InvoiceStatus | undefined;
    const done =
      nextStatus === "CONFIRMADA"
        ? "Fatura confirmada."
        : nextStatus === "REJEITADA"
          ? "Fatura rejeitada."
          : "Fatura corrigida.";
    void patch(
      id,
      {
        docType: d.get("docType"),
        number: textOrNull(d.get("number")),
        atcud: textOrNull(d.get("atcud")),
        issueDate: textOrNull(d.get("issueDate")),
        issuerName: textOrNull(d.get("issuerName")),
        issuerNif: textOrNull(d.get("issuerNif")),
        buyerName: textOrNull(d.get("buyerName")),
        buyerNif: textOrNull(d.get("buyerNif")),
        netTotal: numberOrNull(d.get("netTotal")),
        vatTotal: numberOrNull(d.get("vatTotal")),
        total: numberOrNull(d.get("total")),
        ...(nextStatus ? { status: nextStatus } : {}),
      },
      done,
    );
  }

  if (invoices.length === 0)
    return (
      <div className="cartao">
        <div className="vazio">
          <p className="vazio-titulo">Sem faturas</p>
          <p>Quando o agente encontrar faturas nos emails dos clientes, aparecem aqui.</p>
        </div>
      </div>
    );

  const columns = showClient ? 9 : 8;
  return (
    <>
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
              {showClient && <th>Cliente</th>}
              <th>Data</th>
              <th>Documento</th>
              <th>Emitente</th>
              <th>Base</th>
              <th>IVA</th>
              <th>Total</th>
              <th>Estado</th>
              <th>
                <span className="so-leitor">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <InvoiceRows
                key={i.id}
                invoice={i}
                showClient={showClient}
                columns={columns}
                editing={editing === i.id}
                busy={busy}
                onEdit={() => setEditing(editing === i.id ? null : i.id)}
                onSave={(e) => save(e, i.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function InvoiceRows({
  invoice: i,
  showClient,
  columns,
  editing,
  busy,
  onEdit,
  onSave,
}: {
  invoice: InvoiceView;
  showClient: boolean;
  columns: number;
  editing: boolean;
  busy: boolean;
  onEdit: () => void;
  onSave: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const input = (name: keyof InvoiceView, label: string, type = "text") => (
    <div className="campo">
      <label className="campo-rotulo" htmlFor={`${i.id}-${name}`}>
        {label}
      </label>
      <input
        className="entrada"
        id={`${i.id}-${name}`}
        name={name}
        type={type}
        step={type === "number" ? "0.01" : undefined}
        defaultValue={(i[name] as string | number | null) ?? ""}
      />
    </div>
  );
  return (
    <>
      <tr>
        {showClient && (
          <td>
            <a className="forte" href={`/clientes/${i.clientId}?tab=faturas`}>
              {i.clientName}
            </a>
          </td>
        )}
        <td>{i.issueDate ?? "—"}</td>
        <td>
          <span className="forte">{i.number ?? DOC_TYPE_LABELS[i.docType]}</span>
          <div className="discreto">
            {DOC_TYPE_LABELS[i.docType]}
            {i.direction === "COMPRA" ? " · compra" : i.direction === "VENDA" ? " · venda" : ""}
          </div>
        </td>
        <td>
          {i.issuerName ?? "—"}
          {i.issuerNif && <div className="discreto">NIF {i.issuerNif}</div>}
        </td>
        <td>{money(i.netTotal, i.currency)}</td>
        <td>{money(i.vatTotal, i.currency)}</td>
        <td className="forte">{money(i.total, i.currency)}</td>
        <td>
          <span className={STATUS_CLASS[i.status]} title={i.reviewReasons.join(" ")}>
            <span className="ponto" />
            <span>{STATUS_LABELS[i.status]}</span>
          </span>
          {i.status === "A_REVER" && i.reviewReasons.length > 0 && (
            <div className="discreto" style={{ fontSize: 12 }}>
              {i.reviewReasons[0]}
            </div>
          )}
        </td>
        <td className="acoes">
          <div className="linha">
            <a
              className="botao fantasma"
              href={`/api/invoices/${i.id}/file`}
              target="_blank"
              rel="noreferrer"
            >
              Abrir
            </a>
            <button type="button" className="botao fantasma" disabled={busy} onClick={onEdit}>
              {editing ? "Fechar" : "Rever"}
            </button>
          </div>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={columns}>
            <form className="formulario" onSubmit={onSave} style={{ display: "grid", gap: 12 }}>
              <p className="discreto">
                {i.fileName} · email «{i.emailSubject}»
              </p>
              <div className="grelha-campos">
                <div className="campo">
                  <label className="campo-rotulo" htmlFor={`${i.id}-docType`}>
                    Tipo
                  </label>
                  <select
                    className="entrada"
                    id={`${i.id}-docType`}
                    name="docType"
                    defaultValue={i.docType}
                  >
                    {INVOICE_DOC_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {DOC_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
                {input("number", "Número")}
                {input("atcud", "ATCUD")}
                {input("issueDate", "Data", "date")}
                {input("issuerName", "Emitente")}
                {input("issuerNif", "NIF emitente")}
                {input("buyerName", "Adquirente")}
                {input("buyerNif", "NIF adquirente")}
                {input("netTotal", "Base", "number")}
                {input("vatTotal", "IVA", "number")}
                {input("total", "Total", "number")}
              </div>
              <div className="linha">
                <button type="submit" className="botao" disabled={busy}>
                  Guardar correções
                </button>
                {/* Confirmar e Rejeitar também guardam as correções que estiverem no formulário. */}
                <button
                  type="submit"
                  name="status"
                  value="CONFIRMADA"
                  className="botao primario"
                  disabled={busy}
                >
                  Confirmar
                </button>
                <button
                  type="submit"
                  name="status"
                  value="REJEITADA"
                  className="botao fantasma perigo"
                  disabled={busy}
                >
                  Rejeitar
                </button>
              </div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}
