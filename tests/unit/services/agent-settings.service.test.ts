import type { AgentDefinition } from "@/server/agents/core/types";
import { AgentRegistry } from "@/server/agents/registry";
import { AgentSettingsService } from "@/server/services/agent-settings.service";
import { FakeAgentSettingRepository } from "../../setup/fake-knowledge";

const agent: AgentDefinition = {
  id: "assistente",
  name: "Assistente",
  prompt: "Instruções de origem.",
  tools: [],
  channels: ["WEB"],
  office: { agentId: "eva", workingText: "A responder" },
};

function setup() {
  const repository = new FakeAgentSettingRepository();
  const service = new AgentSettingsService(new AgentRegistry().registerAgent(agent), repository);
  return { repository, service };
}

describe("AgentSettingsService", () => {
  it("usa as instruções de origem enquanto o admin não as muda", async () => {
    const { service } = setup();
    await expect(service.promptOf("assistente")).resolves.toBe("Instruções de origem.");
    await expect(service.list()).resolves.toEqual([
      {
        id: "assistente",
        name: "Assistente",
        prompt: "Instruções de origem.",
        defaultPrompt: "Instruções de origem.",
        customized: false,
      },
    ]);
  });

  it("passa a usar as instruções do admin, e volta às de origem ao repor", async () => {
    const { service } = setup();
    await service.setPrompt("assistente", "  Responde sempre em pt-PT.  ");
    await expect(service.promptOf("assistente")).resolves.toBe("Responde sempre em pt-PT.");
    await expect(service.list()).resolves.toMatchObject([{ customized: true }]);

    await service.resetPrompt("assistente");
    await expect(service.promptOf("assistente")).resolves.toBe("Instruções de origem.");
  });

  it("responde 404 a um agente que não existe", async () => {
    const { service, repository } = setup();
    await expect(service.setPrompt("x", "p")).rejects.toMatchObject({ status: 404 });
    await expect(service.promptOf("x")).rejects.toMatchObject({ status: 404 });
    expect(repository.prompts.size).toBe(0);
  });
});
