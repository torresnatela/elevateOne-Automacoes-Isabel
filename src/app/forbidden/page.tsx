import Link from "next/link";
import { Icon } from "@/views/components/Icon";

export const metadata = { title: "Acesso negado | ElevateOne" };

export default function ForbiddenPage() {
  return (
    <div className="centro">
      <main className="centro-coluna">
        <div className="cartao">
          <div className="vazio" style={{ padding: "8px 0" }}>
            <span className="ladrilho" aria-hidden="true">
              <Icon name="cadeado" />
            </span>
            <p className="rotulo">Erro 403</p>
            <h1 className="vazio-titulo">Acesso negado</h1>
            <p>
              Não tem permissão para abrir esta página. Se precisa dela, fale com o administrador.
            </p>
          </div>
          <Link className="botao primario grande largo" href="/dashboard">
            Voltar ao início
          </Link>
        </div>
      </main>
    </div>
  );
}
