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
    <section className="stack">
      <div>
        <h1>Integrações</h1>
        <p className="muted">As contas que os agentes podem usar em seu nome.</p>
      </div>
      <GoogleConnection status={status} result={google} />
    </section>
  );
}
