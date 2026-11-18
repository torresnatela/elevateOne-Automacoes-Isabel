import {
  PERSONAL_ASSISTANT_ID,
  personalAssistant,
} from "@/server/agents/definitions/personal-assistant";
import { AgentRegistry } from "@/server/agents/registry";
import { googleTools } from "@/server/agents/tools/google.tools";
import { searchKnowledgeTool } from "@/server/agents/tools/search-knowledge.tool";

describe("o assistente pessoal do WhatsApp", () => {
  it("corre no Haiku, com esforço médio", () => {
    expect(personalAssistant.llm).toEqual({ model: "claude-haiku-5-5", effort: "medium" });
  });

  it("mantém o id com que as conversas e o AI Office o conhecem", () => {
    expect(PERSONAL_ASSISTANT_ID).toBe("assistente-isabel");
    expect(personalAssistant.office.agentId).toBe("assistente-isabel");
  });

  it("não fala de uma pessoa em particular: serve quem lhe escreve", () => {
    const shown = [
      personalAssistant.name,
      personalAssistant.prompt,
      personalAssistant.office.role,
      personalAssistant.office.workingText,
    ].join("\n");

    expect(shown).not.toMatch(/Isabel/);
    expect(personalAssistant.prompt).toMatch(/quem escreve/i);
  });

  it("todas as ferramentas que usa estão registadas", () => {
    const registry = new AgentRegistry();
    registry.registerTool(searchKnowledgeTool({ search: async () => [] }));
    for (const tool of googleTools({
      workspaceFor: async () => {
        throw new Error("não é preciso");
      },
    }))
      registry.registerTool(tool);

    expect(() => registry.registerAgent(personalAssistant)).not.toThrow();
  });
});
