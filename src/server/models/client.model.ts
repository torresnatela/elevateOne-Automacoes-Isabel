/** O cliente, independente do Prisma (as camadas de cima não dependem da persistência). */
export const CLIENT_ENTITY_TYPES = [
  "SOCIEDADE",
  "ENI",
  "PARTICULAR",
  "ASSOCIACAO",
  "OUTRO",
] as const;
export type ClientEntityType = (typeof CLIENT_ENTITY_TYPES)[number];

export const VAT_REGIMES = [
  "NORMAL_MENSAL",
  "NORMAL_TRIMESTRAL",
  "ISENTO_ART53",
  "PEQUENOS_RETALHISTAS",
  "NAO_SUJEITO",
] as const;
export type VatRegime = (typeof VAT_REGIMES)[number];

export const ACCOUNTING_REGIMES = ["ORGANIZADA", "SIMPLIFICADO", "NAO_ORGANIZADA"] as const;
export type AccountingRegime = (typeof ACCOUNTING_REGIMES)[number];

export interface Client {
  id: string;
  name: string;
  tradeName: string | null;
  nif: string | null;
  contactEmails: string[];
  emailDomains: string[];
  entityType: ClientEntityType;
  vatRegime: VatRegime | null;
  accountingRegime: AccountingRegime | null;
  caePrincipal: string | null;
  niss: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  responsibleUserId: string | null;
  notes: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** O que se escreve ao criar ou editar um cliente. */
export type ClientData = Omit<Client, "id" | "active" | "createdAt" | "updatedAt">;

export const ENTITY_TYPE_LABELS: Record<ClientEntityType, string> = {
  SOCIEDADE: "Sociedade",
  ENI: "Empresário em nome individual",
  PARTICULAR: "Particular",
  ASSOCIACAO: "Associação / IPSS",
  OUTRO: "Outro",
};

export const VAT_REGIME_LABELS: Record<VatRegime, string> = {
  NORMAL_MENSAL: "Normal mensal",
  NORMAL_TRIMESTRAL: "Normal trimestral",
  ISENTO_ART53: "Isento (art.º 53.º)",
  PEQUENOS_RETALHISTAS: "Pequenos retalhistas",
  NAO_SUJEITO: "Não sujeito",
};

export const ACCOUNTING_REGIME_LABELS: Record<AccountingRegime, string> = {
  ORGANIZADA: "Contabilidade organizada",
  SIMPLIFICADO: "Regime simplificado",
  NAO_ORGANIZADA: "Sem contabilidade organizada",
};

/**
 * Um NIF/NIPC português válido: 9 dígitos, o primeiro de um prefixo atribuído, e o último
 * o dígito de controlo (módulo 11 sobre os oito primeiros, pesos 9 a 2).
 */
export function isValidNif(value: string): boolean {
  if (!/^\d{9}$/.test(value)) return false;
  if (!/^(1|2|3|5|6|8|45|70|71|72|74|75|77|79|90|91|98|99)/.test(value)) return false;
  const sum = [...value.slice(0, 8)].reduce((acc, d, i) => acc + Number(d) * (9 - i), 0);
  const rest = sum % 11;
  const check = rest < 2 ? 0 : 11 - rest;
  return check === Number(value[8]);
}

/** O NIF só com os dígitos (sem «PT», espaços ou pontos). */
export const normalizeNif = (value: string) => value.replace(/^PT/i, "").replace(/\D/g, "");

/** O domínio de um endereço de email, em minúsculas. */
export const domainOf = (email: string) => email.split("@").pop()?.trim().toLowerCase() ?? "";
