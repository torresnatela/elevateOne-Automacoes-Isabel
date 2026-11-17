import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, handleError } from "@/server/lib/http";
import { requireSession } from "@/server/lib/session";
import type { AgentSettingsService } from "@/server/services/agent-settings.service";
import { promptSchema } from "@/server/validators/knowledge.schemas";

/** Controller das instruções dos agentes (só ADMIN). */
export class AgentSettingsController {
  constructor(private readonly settings: AgentSettingsService) {}

  async list(req: NextRequest) {
    try {
      await requireSession(req, "ADMIN");
      return NextResponse.json({ agents: await this.settings.list() });
    } catch (err) {
      return handleError(err);
    }
  }

  async setPrompt(req: NextRequest, agentId: string) {
    try {
      await requireSession(req, "ADMIN");
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return errorResponse(400, "INVALID_JSON", "Corpo da requisição inválido");
      }
      const { prompt } = promptSchema.parse(body);
      await this.settings.setPrompt(agentId, prompt);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return handleError(err);
    }
  }

  async resetPrompt(req: NextRequest, agentId: string) {
    try {
      await requireSession(req, "ADMIN");
      await this.settings.resetPrompt(agentId);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return handleError(err);
    }
  }
}
