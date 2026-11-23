import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/lib/current-user";
import { ChangePasswordForm } from "@/views/components/ChangePasswordForm";
import { initials } from "@/views/lib/initials";

export const metadata = { title: "A minha conta | ElevateOne" };

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="pagina estreita">
      <header className="pagina-cabeca">
        <h1 className="titulo">A minha conta</h1>
        <p className="descricao">Os seus dados de acesso.</p>
      </header>

      <div className="colunas">
        <section className="cartao">
          <div className="cartao-cabeca">
            <span className="avatar grande" aria-hidden="true">
              {initials(user.name)}
            </span>
            <div className="cartao-textos">
              <h2 className="cartao-titulo">{user.name}</h2>
              <p className="cartao-desc">{user.email}</p>
            </div>
          </div>
          <span className="selo">{user.role === "ADMIN" ? "Administrador" : "Utilizador"}</span>
        </section>

        <ChangePasswordForm />
      </div>
    </div>
  );
}
