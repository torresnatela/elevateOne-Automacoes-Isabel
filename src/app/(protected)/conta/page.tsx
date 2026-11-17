import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/lib/current-user";
import { ChangePasswordForm } from "@/views/components/ChangePasswordForm";

export const metadata = { title: "A minha conta | ElevateOne" };

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <section className="stack">
      <div>
        <h1>A minha conta</h1>
        <p className="muted">
          {user.name} · {user.email}
        </p>
      </div>
      <ChangePasswordForm />
    </section>
  );
}
