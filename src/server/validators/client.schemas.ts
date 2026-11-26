import { z } from "zod";
import {
  ACCOUNTING_REGIMES,
  CLIENT_ENTITY_TYPES,
  VAT_REGIMES,
  isValidNif,
  normalizeNif,
} from "@/server/models/client.model";

/** Um texto opcional: vazio conta como «não preenchido» (`null`). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** Domínios de correio público: um remetente de lá não identifica um cliente. */
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.pt",
  "outlook.com",
  "outlook.pt",
  "live.com",
  "live.com.pt",
  "msn.com",
  "yahoo.com",
  "yahoo.com.br",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "sapo.pt",
  "iol.pt",
  "clix.pt",
  "netcabo.pt",
  "mail.telepac.pt",
  "uol.com.br",
  "bol.com.br",
]);

/** Cada parte começa e acaba numa letra ou algarismo; a última tem só letras. */
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

const uniqueLower = (list: string[]) => [...new Set(list.map((v) => v.trim().toLowerCase()))];

export const clientSchema = z.object({
  name: z.string().trim().min(1, "O nome é obrigatório.").max(200),
  tradeName: optionalText(200),
  nif: z
    .string()
    .nullish()
    .transform((v) => (v ? normalizeNif(v) : null))
    .refine((v) => v === null || isValidNif(v), "NIF inválido."),
  contactEmails: z
    .array(z.string().trim().email("Email inválido."))
    .max(30)
    .default([])
    .transform(uniqueLower),
  emailDomains: z
    .array(
      z
        .string()
        .trim()
        .transform((v) => v.replace(/^@/, "").toLowerCase())
        .pipe(
          z
            .string()
            .regex(DOMAIN_RE, "Domínio inválido.")
            .refine(
              (d) => !FREE_MAIL_DOMAINS.has(d),
              "Domínio de correio público: use os endereços exatos do cliente.",
            ),
        ),
    )
    .max(10)
    .default([])
    .transform(uniqueLower),
  entityType: z.enum(CLIENT_ENTITY_TYPES).default("SOCIEDADE"),
  vatRegime: z
    .enum(VAT_REGIMES)
    .nullish()
    .transform((v) => v ?? null),
  accountingRegime: z
    .enum(ACCOUNTING_REGIMES)
    .nullish()
    .transform((v) => v ?? null),
  caePrincipal: optionalText(5).refine(
    (v) => v === null || /^\d{5}$/.test(v),
    "CAE inválido (5 dígitos).",
  ),
  niss: optionalText(11).refine(
    (v) => v === null || /^\d{11}$/.test(v),
    "NISS inválido (11 dígitos).",
  ),
  address: optionalText(300),
  postalCode: optionalText(8).refine(
    (v) => v === null || /^\d{4}-\d{3}$/.test(v),
    "Código postal inválido (NNNN-NNN).",
  ),
  city: optionalText(100),
  country: z.string().trim().length(2).toUpperCase().default("PT"),
  responsibleUserId: z
    .string()
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  notes: optionalText(4000),
});

export type ClientInput = z.infer<typeof clientSchema>;

export const clientActiveSchema = z.object({ active: z.boolean() });
