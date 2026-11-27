import Link from "next/link";
import { redirect } from "next/navigation";
import { userAdminService } from "@/server/container";
import { getCurrentUser } from "@/server/lib/current-user";
import { ClientForm } from "@/views/components/ClientForm";

export const metadata = { title: "Novo cliente | ElevateOne" };

export default async function NewClientPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const users = (await userAdminService.list()).filter((u) => u.active);
  return (
    <div className="pagina estreita">
      <header className="pagina-cabeca">
        <Link className="discreto" href="/clientes">
          ← Clientes
        </Link>
        <h1 className="titulo">Novo cliente</h1>
      </header>
      <ClientForm users={users.map((u) => ({ id: u.id, name: u.name }))} />
    </div>
  );
}
