import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@/server/lib/errors";
import { errorResponse, handleError } from "@/server/lib/http";
import { requireSession } from "@/server/lib/session";
import type { ChatService } from "@/server/services/chat.service";
import { sendMessageSchema } from "@/server/validators/chat.schemas";

/**
 * O que a resposta leva, uma linha de JSON por evento (NDJSON):
 * `delta` (um bocado de texto), `tool` (começou a usar uma ferramenta: o texto até
 * aqui era só um aparte), `done` (a resposta inteira) ou `error`.
 */
export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; statusText: string | null }
  | { type: "done"; text: string }
  | { type: "error"; message: string };

/** Controller do chat interno: traduz HTTP <-> ChatService. */
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  async list(req: NextRequest) {
    try {
      const session = await requireSession(req);
      return NextResponse.json({ conversations: await this.chat.list(session.userId) });
    } catch (err) {
      return handleError(err);
    }
  }

  async start(req: NextRequest) {
    try {
      const session = await requireSession(req);
      const conversation = await this.chat.start(session.userId);
      return NextResponse.json({ conversation }, { status: 201 });
    } catch (err) {
      return handleError(err);
    }
  }

  async messages(req: NextRequest, conversationId: string) {
    try {
      const session = await requireSession(req);
      return NextResponse.json({
        messages: await this.chat.messages(conversationId, session.userId),
      });
    } catch (err) {
      return handleError(err);
    }
  }

  async remove(req: NextRequest, conversationId: string) {
    try {
      const session = await requireSession(req);
      await this.chat.remove(conversationId, session.userId);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return handleError(err);
    }
  }

  /** Responde em streaming. Os erros de entrada saem como HTTP; os de depois, como evento `error`. */
  async send(req: NextRequest, conversationId: string) {
    let userId: string;
    let text: string;
    try {
      userId = (await requireSession(req)).userId;
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return errorResponse(400, "INVALID_JSON", "Corpo da requisição inválido");
      }
      ({ text } = sendMessageSchema.parse(body));
      await this.chat.prepare(conversationId, userId);
    } catch (err) {
      return handleError(err);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        let open = true;
        const emit = (event: ChatStreamEvent) => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            // Quem pediu foi-se embora: a resposta continua e fica guardada na conversa.
            open = false;
          }
        };
        try {
          const result = await this.chat.send(conversationId, userId, text, {
            onText: (delta) => emit({ type: "delta", text: delta }),
            onTool: (tool) => emit({ type: "tool", statusText: tool.statusText }),
          });
          emit({ type: "done", text: result.text });
        } catch (err) {
          if (!(err instanceof AppError)) console.error(err);
          emit({
            type: "error",
            message:
              err instanceof AppError
                ? err.message
                : "Não foi possível responder agora. Tente novamente daqui a pouco.",
          });
        } finally {
          if (open) controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
        "x-accel-buffering": "no",
      },
    });
  }
}
