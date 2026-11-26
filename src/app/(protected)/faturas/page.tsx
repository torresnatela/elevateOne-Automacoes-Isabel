import { redirect } from "next/navigation";
import { clientMailService, clientService } from "@/server/container";
import { getCurrentUser } from "@/server/lib/current-user";
import { INVOICE_STATUSES, STATUS_LABELS } from "@/server/models/client-mail.model";
import { invoiceFilterSchema } from "@/server/validators/invoice.schemas";
import { InvoicesTable } from "@/views/components/InvoicesTable";
import { MailSyncPanel } from "@/views/components/MailSyncPanel";

export const metadata = { title: "Faturas | ElevateOne" };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const raw = await searchParams;
  // Por omissão, o que falta rever.
  const params: Record<string, string | undefined> = { status: "A_REVER", ...raw };
  const parsed = invoiceFilterSchema.safeParse(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v)),
  );
  // Um filtro inválido não se ignora (mostrava tudo): avisa e não procura.
  const filterError = parsed.success
    ? null
    : "Filtro inválido: confira o cliente, o estado e as datas.";
  const query = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();

  const [invoices, clients, mailboxes] = await Promise.all([
    parsed.success ? clientMailService.listInvoices(parsed.data) : Promise.resolve([]),
    clientService.list({ includeInactive: true }),
    clientMailService.mailboxes(),
  ]);

  return (
    <div className="pagina">
      <header className="pagina-cabeca">
        <h1 className="titulo">Faturas</h1>
        <p className="descricao">
          As faturas que os clientes enviaram por email, lidas pelo agente. As que ficaram «a rever»
          têm algo que não bate certo: confirme ou corrija.
        </p>
      </header>

      <MailSyncPanel
        mailboxes={mailboxes.map((m) => ({
          mailbox: m.mailbox,
          lastRunAt: m.lastRunAt?.toISOString() ?? null,
          lastError: m.lastError,
        }))}
      />

      <form className="linha filtros" method="get">
        <select
          className="entrada"
          name="clientId"
          defaultValue={params.clientId ?? ""}
          aria-label="Cliente"
        >
          <option value="">Todos os clientes</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className="entrada"
          name="status"
          defaultValue={raw.status ?? "A_REVER"}
          aria-label="Estado"
        >
          <option value="">Todos os estados</option>
          {INVOICE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <input
          className="entrada"
          type="date"
          name="from"
          defaultValue={params.from ?? ""}
          aria-label="De"
        />
        <input
          className="entrada"
          type="date"
          name="to"
          defaultValue={params.to ?? ""}
          aria-label="Até"
        />
        <button type="submit" className="botao">
          Filtrar
        </button>
        {!filterError && (
          <a className="botao fantasma" href={`/api/invoices/export?${query}`}>
            Exportar CSV
          </a>
        )}
      </form>

      {filterError && (
        <p role="alert" className="mensagem erro">
          {filterError}
        </p>
      )}

      <InvoicesTable
        key={query}
        showClient
        initialInvoices={invoices.map((i) => ({ ...i, receivedAt: i.receivedAt.toISOString() }))}
      />
    </div>
  );
}
