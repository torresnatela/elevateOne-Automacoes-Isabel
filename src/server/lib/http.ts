import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "./errors";

export function errorResponse(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

/** Converte exceções conhecidas em respostas HTTP padronizadas. */
export function handleError(err: unknown) {
  if (err instanceof AppError) return errorResponse(err.status, err.code, err.message);
  if (err instanceof ZodError) {
    return errorResponse(400, "VALIDATION_ERROR", "Dados inválidos", err.flatten().fieldErrors);
  }
  console.error(err);
  return errorResponse(500, "INTERNAL_ERROR", "Erro interno");
}
