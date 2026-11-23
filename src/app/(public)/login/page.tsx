import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/lib/current-user";
import { BrandMark } from "@/views/components/BrandMark";
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
    <div className="centro">
      <main className="centro-coluna">
        <div className="centro-marca">
          <BrandMark size="grande" />
          <div className="pagina-cabeca">
            <h1 className="titulo">ElevateOne</h1>
            <p className="descricao">A sua equipa digital</p>
          </div>
        </div>
        <LoginForm next={next} />
        <p className="centro-pe">
          Acesso reservado à equipa. Se perdeu a senha, peça ao administrador que a reponha.
        </p>
      </main>
    </div>
  );
}
