import { z } from "zod";
import type { KnowledgeService } from "@/server/services/knowledge.service";
import type { ToolDefinition } from "../core/types";

const schema = z.object({
  pergunta: z
    .string()
    .min(1)
    .describe("O que procurar, em linguagem natural e com os termos que os documentos usariam."),
});

export const SEARCH_KNOWLEDGE_TOOL = "buscar_conhecimento";

/** Procura na base de conhecimento do escritório e devolve os excertos com o documento de origem. */
export function searchKnowledgeTool(
  knowledge: Pick<KnowledgeService, "search">,
): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: SEARCH_KNOWLEDGE_TOOL,
    description:
      "Procura na base de conhecimento do escritório (procedimentos, regras internas, guias e notas da Isabel). " +
      "Usa-a antes de responder a qualquer dúvida sobre como o escritório trabalha ou sobre matéria contabilística e fiscal. " +
      "Devolve excertos com o título do documento de origem; se não encontrar nada, a base não cobre o assunto. " +
      "Podes procurar mais de uma vez, com outras palavras.",
    schema,
    requiresConfirmation: false,
    statusText: "A consultar a base de conhecimento…",
    async execute(_ctx, { pergunta }) {
      const hits = await knowledge.search(pergunta);
      if (hits.length === 0)
        return { encontrado: false, nota: "A base de conhecimento não tem nada sobre isto." };
      return {
        encontrado: true,
        excertos: hits.map((hit) => ({ documento: hit.documentTitle, texto: hit.content })),
      };
    },
  };
}
