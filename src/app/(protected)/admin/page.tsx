import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/lib/current-user";
import { hasRole } from "@/server/policies/authorization";
import { Icon, type IconName } from "@/views/components/Icon";

export const metadata = { title: "Administração | ElevateOne" };

const AREAS: { href: string; icon: IconName; title: string; text: string }[] = [
  {
    href: "/admin/utilizadores",
    icon: "pessoas",
    title: "Utilizadores",
    text: "Quem pode entrar no sistema, com que papel, e a reposição de senhas.",
  },
  {
    href: "/admin/conhecimento",
    icon: "livro",
    title: "Base de conhecimento",
    text: "Os ficheiros que o chat interno usa e as instruções de cada agente.",
  },
  {
    href: "/admin/whatsapp",
    icon: "telemovel",
    title: "WhatsApp",
    text: "Os números a que o assistente pessoal responde.",
  },
];

export default async function AdminPage() {
  const user = await getCurrentUser();
  // Defesa em profundidade: o middleware já bloqueia, mas a página também confere.
  if (!hasRole(user, "ADMIN")) redirect("/forbidden");

  return (
    <div className="pagina">
      <header className="pagina-cabeca">
        <h1 className="titulo">Administração</h1>
        <p className="descricao">Área restrita a administradores.</p>
      </header>
      <div className="colunas">
        {AREAS.map((area) => (
          <Link key={area.href} className="cartao" href={area.href}>
            <span className="ladrilho" aria-hidden="true">
              <Icon name={area.icon} />
            </span>
            <span className="cartao-textos">
              <span className="cartao-titulo">{area.title}</span>
              <span className="cartao-desc">{area.text}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
