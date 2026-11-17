/**
 * Models de domínio das conversas com os agentes. Independentes do Prisma e do
 * fornecedor do modelo de linguagem.
 */
export const CHANNELS = ["WEB", "WHATSAPP"] as const;
export type Channel = (typeof CHANNELS)[number];

export type MessageRole = "USER" | "ASSISTANT";

/**
 * Um bloco de conteúdo de uma mensagem, tal como o modelo o lê e devolve (texto,
 * pedido de ferramenta, resultado, raciocínio…). Os blocos que o sistema não
 * conhece guardam-se e reenviam-se sem mexer: o modelo precisa deles intactos.
 */
export interface ContentBlock {
  type: string;
  [key: string]: unknown;
}

export interface TextBlock extends ContentBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock extends ContentBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock extends ContentBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export const isTextBlock = (b: ContentBlock): b is TextBlock =>
  b.type === "text" && typeof b.text === "string";

export const isToolUseBlock = (b: ContentBlock): b is ToolUseBlock =>
  b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string";

export const textBlock = (text: string): TextBlock => ({ type: "text", text });

/** O texto de uma mensagem: os blocos de texto, juntos. */
export const textOf = (content: readonly ContentBlock[]): string =>
  content
    .filter(isTextBlock)
    .map((b) => b.text)
    .join("\n")
    .trim();

export interface Conversation {
  id: string;
  agentId: string;
  channel: Channel;
  userId: string | null;
  /** Quem fala, fora do sistema (ex.: o número do WhatsApp). */
  externalId: string | null;
  /** O que aparece na lista de conversas. */
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewConversation {
  agentId: string;
  channel: Channel;
  userId?: string | null;
  externalId?: string | null;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: ContentBlock[];
  createdAt: Date;
}
