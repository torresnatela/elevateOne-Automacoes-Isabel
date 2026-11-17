import { redirect } from "next/navigation";
import { userAdminService } from "@/server/container";
import { getCurrentUser } from "@/server/lib/current-user";
import { hasRole } from "@/server/policies/authorization";
import { UsersManager } from "@/views/components/UsersManager";

export const metadata = { title: "Utilizadores | ElevateOne" };

export default async function UsersPage() {
  const user = await getCurrentUser();
  // Defesa em profundidade: o middleware já bloqueia, mas a página também confere.
  if (!user || !hasRole(user, "ADMIN")) redirect("/forbidden");

  const users = await userAdminService.list();
  return (
    <section className="stack">
      <div>
        <h1>Utilizadores</h1>
        <p className="muted">
          Quem pode entrar no sistema. Um utilizador usa o chat e liga a sua conta Google; um
          administrador gere também a base de conhecimento, os agentes e os utilizadores.
        </p>
      </div>
      <UsersManager
        currentUserId={user.id}
        initialUsers={users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          active: u.active,
        }))}
      />
    </section>
  );
}
