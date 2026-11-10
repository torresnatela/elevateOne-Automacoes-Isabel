import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string({ required_error: "Informe o e-mail" })
    .trim()
    .toLowerCase()
    .email("E-mail inválido"),
  password: z
    .string({ required_error: "Informe a senha" })
    .min(1, "Informe a senha")
    .max(200, "Senha muito longa"),
});

export type LoginInput = z.infer<typeof loginSchema>;
