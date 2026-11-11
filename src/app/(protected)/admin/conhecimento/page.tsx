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
    <section className="stack">
      <div>
        <h1>Base de conhecimento</h1>
        <p className="muted">
          Os ficheiros que o chat interno usa para responder à equipa. Um PDF digitalizado, sem
          texto, não pode ser lido.
        </p>
      </div>
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

      <div>
        <h2>Instruções dos agentes</h2>
        <p className="muted">
          Como cada agente se deve comportar. As mudanças valem na mensagem seguinte.
        </p>
      </div>
      {agents.length === 0 ? (
        <p className="muted">Ainda não há agentes.</p>
      ) : (
        agents.map((agent) => <AgentPromptEditor key={agent.id} agent={agent} />)
      )}
    </section>
  );
}
