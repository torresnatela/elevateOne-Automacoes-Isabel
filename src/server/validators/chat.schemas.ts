import { z } from "zod";

export const sendMessageSchema = z.object({
  text: z.string().trim().min(1, "Escreva uma mensagem").max(20_000, "A mensagem é longa demais"),
});
