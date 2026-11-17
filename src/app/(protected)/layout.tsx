import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/lib/current-user";
import { LogoutButton } from "@/views/components/LogoutButton";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <>
      <header className="topbar">
        <span className="brand">ElevateOne</span>
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/chat">Chat</Link>
        <Link href="/integracoes">Integrações</Link>
        {user.role === "ADMIN" && <Link href="/admin">Admin</Link>}
        <Link className="who" href="/conta" title="A minha conta">
          {user.name} ({user.role})
        </Link>
        <LogoutButton />
      </header>
      <main className="content">{children}</main>
    </>
  );
}
