import { z } from "zod";

export const promptSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(1, "Escreva as instruções")
    .max(50_000, "As instruções são longas demais"),
});
