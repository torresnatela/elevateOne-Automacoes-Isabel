import { redirect } from "next/navigation";
import { userAdminService } from "@/server/container";
import { getCurrentUser } from "@/server/lib/current-user";
import { hasRole } from "@/server/policies/authorization";
import { WhatsappNumbers } from "@/views/components/WhatsappNumbers";

export const metadata = { title: "WhatsApp | ElevateOne" };

export default async function WhatsappPage() {
  const user = await getCurrentUser();
  // Defesa em profundidade: o middleware já bloqueia, mas a página também confere.
  if (!hasRole(user, "ADMIN")) redirect("/forbidden");

  const users = await userAdminService.list();
  return (
    <div className="pagina estreita">
      <header className="pagina-cabeca">
        <h1 className="titulo">WhatsApp</h1>
        <p className="descricao">
          O assistente só responde aos números desta lista. Cada pessoa fala com ele a partir do seu
          número, e ele age na conta Google que essa pessoa ligou em Integrações. A quem não está
          aqui, não responde.
        </p>
      </header>
      <WhatsappNumbers
        users={users.map((u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone }))}
      />
    </div>
  );
}
