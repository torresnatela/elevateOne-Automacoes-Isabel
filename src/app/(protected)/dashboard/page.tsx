import Link from "next/link";
import { redirect } from "next/navigation";
import { googleService, knowledgeService, officeService } from "@/server/container";
import { getCurrentUser } from "@/server/lib/current-user";
import { fromLocalDateTime, OFFICE_TIME_ZONE, toLocalDateTime } from "@/server/lib/time";
import type { OfficeState } from "@/server/services/office.service";
import { Icon, type IconName } from "@/views/components/Icon";

export const metadata = { title: "Início | ElevateOne" };

const STATE_CLASS: Record<OfficeState, string> = {
  trabalho: "estado trabalho",
  pausa: "estado sucesso",
  ajuda: "estado ajuda",
};

/** O ícone de cada tipo de tarefa do AI Office. */
function iconOf(type: string): IconName {
  if (["marcacao", "reuniao", "videochamada", "visita"].includes(type)) return "agenda";
  if (type === "email") return "email";
  if (["mensagem", "apoio", "chamada", "coordenacao"].includes(type)) return "chat";
  if (["arquivo", "contrato", "projeto", "fatura", "proposta"].includes(type)) return "documento";
  return "certo";
}

const timeOf = (date: Date) =>
  new Intl.DateTimeFormat("pt-PT", {
    timeZone: OFFICE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

/** «75» → «1 h 15 min». */
function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const isAdmin = user.role === "ADMIN";

  // O dia do escritório começa à meia-noite de Lisboa.
  const startOfDay = fromLocalDateTime(`${toLocalDateTime(new Date()).slice(0, 10)}T00:00`);
  const [today, google, documents] = await Promise.all([
    officeService.today(startOfDay),
    googleService.status(user.id),
    isAdmin ? knowledgeService.list() : Promise.resolve(null),
  ]);

  const googleState = !google.connected
    ? { className: "estado neutro", text: "Por ligar" }
    : google.missingScopes.length > 0
      ? { className: "estado aviso", text: "Faltam permissões" }
      : { className: "estado sucesso", text: "Ligada" };

  return (
    <div className="pagina">
      <header className="pagina-cabeca">
        <h1 className="titulo">Olá, {user.name}</h1>
        <p className="descricao">O que a sua equipa digital fez hoje.</p>
      </header>

      <section className="cartao">
        <div className="cartao-cabeca">
          <span className="ladrilho" aria-hidden="true">
            <Icon name="chat" />
          </span>
          <div className="cartao-textos">
            <h2 className="cartao-titulo">Pergunte ao assistente interno</h2>
            <p className="cartao-desc">
              Um procedimento do escritório, uma dúvida fiscal, um email para rever.
            </p>
          </div>
          <Link className="botao primario grande" href="/chat">
            Fazer uma pergunta
          </Link>
        </div>
      </section>

      <section className="pagina-cabeca" aria-labelledby="equipa">
        <h2 className="rotulo" id="equipa">
          A equipa digital
        </h2>
        <div className="colunas">
          {today.agentes.map((agent) => (
            <article key={agent.id} className="cartao" style={{ gap: 12 }}>
              <h3 className="cartao-titulo">{agent.nome}</h3>
              {agent.funcao && <p className="cartao-desc">{agent.funcao}</p>}
              <span className={STATE_CLASS[agent.estado]}>
                <span className={agent.estado === "trabalho" ? "ponto vivo" : "ponto"} />
                <span>{agent.texto}</span>
              </span>
            </article>
          ))}
        </div>
      </section>

      <div className="colunas">
        <section className="cartao largo" style={{ gap: 8 }}>
          <div className="cartao-cabeca">
            <h2 className="cartao-titulo" style={{ flex: 1 }}>
              Atividade de hoje
            </h2>
            {today.minutos > 0 && (
              <span className="cartao-desc">
                Levaria a uma pessoa {formatMinutes(today.minutos)}
              </span>
            )}
          </div>
          {today.recentes.length === 0 ? (
            <p className="cartao-desc" style={{ padding: "16px 0" }}>
              Ainda nada hoje. O que os agentes fizerem aparece aqui.
            </p>
          ) : (
            <ul className="lista">
              {today.recentes.map((task) => (
                <li key={task.n} className="lista-linha">
                  <span className="ladrilho pequeno" aria-hidden="true">
                    <Icon name={iconOf(task.tipo)} small />
                  </span>
                  <span className="lista-textos">
                    <span className="lista-titulo">{task.texto}</span>
                    <span className="lista-desc">
                      {task.agente} · {timeOf(task.agora)}
                    </span>
                  </span>
                  {task.minutos > 0 && (
                    <span className="lista-valor">{formatMinutes(task.minutos)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="cartao" style={{ gap: 8 }}>
          <h2 className="cartao-titulo">A sua configuração</h2>
          <ul className="lista">
            <li>
              <Link className="lista-linha" href="/integracoes">
                <span className="lista-textos">
                  <span className="lista-titulo">Conta Google</span>
                  <span className="lista-desc">
                    {google.connected
                      ? google.email
                      : "Para os agentes usarem a sua agenda e o email"}
                  </span>
                </span>
                <span className={googleState.className}>
                  <span className="ponto" />
                  <span>{googleState.text}</span>
                </span>
              </Link>
            </li>
            <li>
              {isAdmin ? (
                <Link className="lista-linha" href="/admin/whatsapp">
                  <WhatsappRow phone={user.phone} />
                </Link>
              ) : (
                <div className="lista-linha">
                  <WhatsappRow phone={user.phone} />
                </div>
              )}
            </li>
            {documents && (
              <li>
                <Link className="lista-linha" href="/admin/conhecimento">
                  <span className="lista-textos">
                    <span className="lista-titulo">Base de conhecimento</span>
                    <span className="lista-desc">O que o assistente interno sabe</span>
                  </span>
                  <span className="estado neutro" style={{ paddingLeft: 12 }}>
                    <span>
                      {documents.length === 1 ? "1 ficheiro" : `${documents.length} ficheiros`}
                    </span>
                  </span>
                </Link>
              </li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}

function WhatsappRow({ phone }: { phone: string | null }) {
  return (
    <>
      <span className="lista-textos">
        <span className="lista-titulo">WhatsApp</span>
        <span className="lista-desc">
          {phone
            ? "O assistente pessoal responde ao seu número"
            : "Peça ao administrador que autorize o seu número"}
        </span>
      </span>
      <span className={phone ? "estado sucesso" : "estado neutro"}>
        <span className="ponto" />
        <span>{phone ? "Autorizado" : "Sem número"}</span>
      </span>
    </>
  );
}
