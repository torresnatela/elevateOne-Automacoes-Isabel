import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/lib/current-user";
import { AppNav } from "@/views/components/AppNav";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="app">
      <AppNav user={{ name: user.name, role: user.role }} />
      <main className="principal">{children}</main>
    </div>
  );
}
