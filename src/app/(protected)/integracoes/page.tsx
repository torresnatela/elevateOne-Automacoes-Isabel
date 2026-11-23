import { redirect } from "next/navigation";
import { googleService } from "@/server/container";
import { getCurrentUser } from "@/server/lib/current-user";
import { GoogleConnection } from "@/views/components/GoogleConnection";

export const metadata = { title: "Integrações | ElevateOne" };

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [status, { google }] = await Promise.all([googleService.status(user.id), searchParams]);
  return (
    <div className="pagina estreita">
      <header className="pagina-cabeca">
        <h1 className="titulo">Integrações</h1>
        <p className="descricao">As contas que os agentes podem usar em seu nome.</p>
      </header>
      <GoogleConnection status={status} result={google} />
    </div>
  );
}
