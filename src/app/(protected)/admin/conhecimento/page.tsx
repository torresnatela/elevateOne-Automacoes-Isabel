import { redirect } from "next/navigation";
import { agentSettingsService, knowledgeService } from "@/server/container";
import { getCurrentUser } from "@/server/lib/current-user";
import { hasRole } from "@/server/policies/authorization";
import { AgentPromptEditor } from "@/views/components/AgentPromptEditor";
import { KnowledgeManager } from "@/views/components/KnowledgeManager";

export const metadata = { title: "Base de conhecimento | ElevateOne" };

export default async function KnowledgePage() {
  const user = await getCurrentUser();
  // Defesa em profundidade: o middleware já bloqueia, mas a página também confere.
  if (!hasRole(user, "ADMIN")) redirect("/forbidden");

  const [documents, agents] = await Promise.all([
    knowledgeService.list(),
    agentSettingsService.list(),
  ]);

  return (
    <div className="pagina">
      <header className="pagina-cabeca">
        <h1 className="titulo">Base de conhecimento</h1>
        <p className="descricao">
          Os ficheiros que o chat interno usa para responder à equipa. Um PDF digitalizado, sem
          texto, não pode ser lido.
        </p>
      </header>
      <KnowledgeManager
        initialDocuments={documents.map((d) => ({
          id: d.id,
          title: d.title,
          fileName: d.fileName,
          size: d.size,
          chunkCount: d.chunkCount,
          createdAt: d.createdAt.toISOString(),
        }))}
      />

      <header className="pagina-cabeca" style={{ paddingTop: 16 }}>
        <h2 className="subtitulo">Instruções dos agentes</h2>
        <p className="descricao">
          Como cada agente se deve comportar. As mudanças valem na mensagem seguinte.
        </p>
      </header>
      {agents.length === 0 ? (
        <p className="mensagem nota">Ainda não há agentes.</p>
      ) : (
        <div className="colunas">
          {agents.map((agent) => (
            <AgentPromptEditor key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}
