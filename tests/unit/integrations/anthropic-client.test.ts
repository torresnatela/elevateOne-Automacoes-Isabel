import { anthropicClientOptions } from "@/server/integrations/anthropic/anthropic-client";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

describe("anthropicClientOptions", () => {
  it("com uma chave já ligada a um workspace, não acrescenta nada", () => {
    expect(anthropicClientOptions(env({}))).toEqual({});
    expect(anthropicClientOptions(env({ ANTHROPIC_WORKSPACE_ID: "  " }))).toEqual({});
  });

  it("com o id do workspace, envia-o em todos os pedidos", () => {
    expect(anthropicClientOptions(env({ ANTHROPIC_WORKSPACE_ID: " wrkspc_01abc " }))).toEqual({
      defaultHeaders: { "anthropic-workspace-id": "wrkspc_01abc" },
    });
  });
});
