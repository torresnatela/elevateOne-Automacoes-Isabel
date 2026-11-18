import type { ClientOptions } from "@anthropic-ai/sdk";

/**
 * As opções com que se cria o cliente da Anthropic, além da chave (`ANTHROPIC_API_KEY`,
 * que o SDK lê sozinho). Uma chave que não está ligada a um workspace só é aceite com o
 * id do workspace em cada pedido: vem de `ANTHROPIC_WORKSPACE_ID`.
 */
export function anthropicClientOptions(env: NodeJS.ProcessEnv = process.env): ClientOptions {
  const workspaceId = env.ANTHROPIC_WORKSPACE_ID?.trim();
  return workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {};
}
