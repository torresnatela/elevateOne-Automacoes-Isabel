import Link from "next/link";

export const metadata = { title: "Acesso negado | ElevateOne" };

export default function ForbiddenPage() {
  return (
    <div className="center">
      <div className="card">
        <h1>403 — Acesso negado</h1>
        <p className="sub">Você não tem permissão para acessar esta página.</p>
        <Link href="/dashboard">Voltar ao dashboard</Link>
      </div>
    </div>
  );
}
