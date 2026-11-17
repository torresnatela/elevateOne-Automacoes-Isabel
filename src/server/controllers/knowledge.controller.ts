import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, handleError } from "@/server/lib/http";
import { requireSession } from "@/server/lib/session";
import type { KnowledgeService } from "@/server/services/knowledge.service";

/**
 * Controller da base de conhecimento (só ADMIN): traduz HTTP <-> KnowledgeService.
 * O middleware já barra a rota; aqui confere-se outra vez.
 */
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  async list(req: NextRequest) {
    try {
      await requireSession(req, "ADMIN");
      return NextResponse.json({ documents: await this.knowledge.list() });
    } catch (err) {
      return handleError(err);
    }
  }

  /** Recebe um ficheiro (`multipart/form-data`: `file` e, se quiser, `title`). */
  async upload(req: NextRequest) {
    try {
      const session = await requireSession(req, "ADMIN");
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        return errorResponse(400, "INVALID_FORM", "Envie o ficheiro num formulário");
      }
      const file = form.get("file");
      if (!(file instanceof File))
        return errorResponse(400, "FILE_REQUIRED", "Escolha um ficheiro");
      const title = form.get("title");

      const document = await this.knowledge.ingest({
        fileName: file.name,
        mimeType: file.type,
        data: new Uint8Array(await file.arrayBuffer()),
        title: typeof title === "string" ? title : undefined,
        uploadedById: session.userId,
      });
      return NextResponse.json({ document }, { status: 201 });
    } catch (err) {
      return handleError(err);
    }
  }

  async remove(req: NextRequest, id: string) {
    try {
      await requireSession(req, "ADMIN");
      await this.knowledge.remove(id);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return handleError(err);
    }
  }
}
