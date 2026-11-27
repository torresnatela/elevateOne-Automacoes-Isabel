import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { clientMailService, clientService, userAdminService } from "@/server/container";
import { getCurrentUser } from "@/server/lib/current-user";
import { AppError } from "@/server/lib/errors";
import { hasRole } from "@/server/policies/authorization";
import { ClientForm } from "@/views/components/ClientForm";
import { ClientEmailsList } from "@/views/components/ClientEmailsList";
import { InvoicesTable } from "@/views/components/InvoicesTable";

export const metadata = { title: "Cliente | ElevateOne" };

const TABS = [
  { id: "dados", label: "Dados" },
  { id: "faturas", label: "Faturas" },
  { id: "emails", label: "Emails" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [{ id }, { tab: rawTab }] = await Promise.all([params, searchParams]);
  const tab: Tab = TABS.some((t) => t.id === rawTab) ? (rawTab as Tab) : "dados";

  const client = await clientService.get(id).catch((err) => {
    if (err instanceof AppError && err.status === 404) notFound();
    throw err;
  });
  const users = (await userAdminService.list()).filter(
    (u) => u.active || u.id === client.responsibleUserId,
  );

  return (
    <div className="pagina estreita">
      <header className="pagina-cabeca">
        <Link className="discreto" href="/clientes">
          ← Clientes
        </Link>
        <div className="linha">
          <h1 className="titulo">{client.name}</h1>
          {!client.active && <span className="selo">Desativado</span>}
        </div>
        <p className="descricao">
          {[client.nif && `NIF ${client.nif}`, client.contactEmails[0]].filter(Boolean).join(" · ")}
        </p>
      </header>

      <nav className="separadores" aria-label="Secções do cliente">
        {TABS.map((t) => (
          <Link
            key={t.id}
            className="separador"
            href={
              t.id === "dados" ? `/clientes/${client.id}` : `/clientes/${client.id}?tab=${t.id}`
            }
            aria-current={t.id === tab ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "dados" && (
        <ClientForm
          client={client}
          users={users.map((u) => ({ id: u.id, name: u.name }))}
          isAdmin={hasRole(user, "ADMIN")}
        />
      )}
      {tab === "faturas" && (
        <InvoicesTable
          initialInvoices={(await clientMailService.listInvoices({ clientId: client.id })).map(
            (i) => ({ ...i, receivedAt: i.receivedAt.toISOString() }),
          )}
        />
      )}
      {tab === "emails" && (
        <ClientEmailsList emails={await clientMailService.listEmails(client.id)} />
      )}
    </div>
  );
}
