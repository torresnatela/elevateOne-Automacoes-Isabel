import { redirect } from "next/navigation";
import { clientService, userAdminService } from "@/server/container";
import { getCurrentUser } from "@/server/lib/current-user";
import { ClientsList } from "@/views/components/ClientsList";

export const metadata = { title: "Clientes | ElevateOne" };

export default async function ClientsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [clients, users] = await Promise.all([
    clientService.list({ includeInactive: true }),
    userAdminService.list(),
  ]);
  const names = new Map(users.map((u) => [u.id, u.name]));
  return (
    <div className="pagina">
      <header className="pagina-cabeca">
        <h1 className="titulo">Clientes</h1>
        <p className="descricao">
          Os clientes do gabinete, os emails de onde escrevem e os dados contabilísticos. O agente
          de faturas usa estes emails para juntar o que cada cliente envia.
        </p>
      </header>
      <ClientsList
        clients={clients.map((c) => ({
          id: c.id,
          name: c.name,
          tradeName: c.tradeName,
          nif: c.nif,
          contactEmails: c.contactEmails,
          emailDomains: c.emailDomains,
          responsibleName: c.responsibleUserId ? (names.get(c.responsibleUserId) ?? null) : null,
          active: c.active,
        }))}
      />
    </div>
  );
}
