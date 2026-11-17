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

/** Uma senha nova: comprida o bastante para não se adivinhar. */
export const newPasswordSchema = z
  .string({ required_error: "Informe a senha" })
  .min(8, "A senha tem de ter pelo menos 8 caracteres")
  .max(200, "Senha muito longa");

export const createUserSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  password: newPasswordSchema,
  role: z.enum(["ADMIN", "USER"]).default("USER"),
});

export const setActiveSchema = z.object({ active: z.boolean() });

export const resetPasswordSchema = z.object({ password: newPasswordSchema });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Informe a senha atual").max(200),
  newPassword: newPasswordSchema,
});
