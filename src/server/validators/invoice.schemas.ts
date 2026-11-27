import { z } from "zod";
import { INVOICE_DOC_TYPES, INVOICE_STATUSES, isRealDay } from "@/server/models/client-mail.model";

const dayString = z.string().refine(isRealDay, "Data inválida.");

const text = z
  .string()
  .trim()
  .max(200)
  .nullable()
  .transform((v) => (v ? v : null));
const money = z.number().finite().nullable();

export const invoicePatchSchema = z
  .object({
    docType: z.enum(INVOICE_DOC_TYPES),
    number: text,
    atcud: text,
    issueDate: dayString.nullable(),
    issuerName: text,
    issuerNif: text,
    buyerName: text,
    buyerNif: text,
    netTotal: money,
    vatTotal: money,
    total: money,
    status: z.enum(INVOICE_STATUSES),
  })
  .partial();

const day = dayString.transform((v) => new Date(`${v}T00:00:00.000Z`));

export const invoiceFilterSchema = z.object({
  clientId: z.string().uuid().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  from: day.optional(),
  to: day.optional(),
});
