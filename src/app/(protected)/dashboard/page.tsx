import { getCurrentUser } from "@/server/lib/current-user";

export const metadata = { title: "Dashboard | ElevateOne" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  return (
    <section>
      <h1>Olá, {user?.name}</h1>
      <p>Bem-vindo ao ElevateOne Automações.</p>
    </section>
  );
}
