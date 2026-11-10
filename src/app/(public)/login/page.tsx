import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/lib/current-user";
import { LoginForm } from "@/views/components/LoginForm";

export const metadata = { title: "Entrar | ElevateOne" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { next } = await searchParams;

  return (
    <div className="center">
      <div className="card">
        <h1>ElevateOne</h1>
        <p className="sub">Acesse sua conta</p>
        <LoginForm next={next} />
      </div>
    </div>
  );
}
