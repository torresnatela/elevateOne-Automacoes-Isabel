import type { NextRequest } from "next/server";
import { knowledgeController } from "@/server/container";

export const runtime = "nodejs";
// Ler um ficheiro grande e guardar os pedaços pode demorar.
export const maxDuration = 300;

export function GET(req: NextRequest) {
  return knowledgeController.list(req);
}

export function POST(req: NextRequest) {
  return knowledgeController.upload(req);
}
