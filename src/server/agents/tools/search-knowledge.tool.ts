import { z } from "zod";
import type { KnowledgeService } from "@/server/services/knowledge.service";
import type { ToolDefinition } from "../core/types";

const schema = z.object({
  pergunta: z
    .string()
    .min(1)
    .describe(
      "Palavras-chave a procurar: os termos que os documentos usariam, com sinónimos e siglas " +
        '(ex.: "IVA taxa reduzida isenção"). A procura é por palavras, não por sentido.',
    ),
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
      "A procura é por palavras (sem acentos e sem distinguir singular/plural), não por sentido: " +
      "escreve os termos que os documentos usariam, juntando sinónimos e siglas. " +
      "Devolve excertos com o título do documento de origem, do mais para o menos relevante; lê-os e usa só os que respondem. " +
      "Se não encontrar nada ou os excertos não servirem, procura outra vez com outras palavras antes de concluir que a base não cobre o assunto.",
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
