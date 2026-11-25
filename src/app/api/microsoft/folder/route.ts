import type { NextRequest } from "next/server";
import { microsoftController } from "@/server/container";

export const runtime = "nodejs";

/** O que está na pasta da empresa. */
export function GET(req: NextRequest) {
  return microsoftController.folderItems(req);
}

/** Escolhe a pasta: `{ link }`, um link de partilha ou um caminho no OneDrive. */
export function PUT(req: NextRequest) {
  return microsoftController.setFolder(req);
}

export function DELETE(req: NextRequest) {
  return microsoftController.clearFolder(req);
}
