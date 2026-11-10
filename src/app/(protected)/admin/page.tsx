import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/lib/current-user";
import { hasRole } from "@/server/policies/authorization";

export const metadata = { title: "Admin | ElevateOne" };

export default async function AdminPage() {
  const user = await getCurrentUser();
  // Defesa em profundidade: o middleware já bloqueia, mas a página também confere.
  if (!hasRole(user, "ADMIN")) redirect("/forbidden");

  return (
    <section>
      <h1>Administração</h1>
      <p>Área restrita a administradores.</p>
    </section>
  );
}
