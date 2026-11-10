import "server-only";
import { prisma } from "@/server/lib/db";
import { AuthController } from "@/server/controllers/auth.controller";
import { PrismaUserRepository } from "@/server/repositories/user.repository";
import { AuthService } from "@/server/services/auth.service";

/** Composição das dependências (injeção manual). Ponto único para trocar implementações. */
export const userRepository = new PrismaUserRepository(prisma);
export const authService = new AuthService(userRepository);
export const authController = new AuthController(authService);
