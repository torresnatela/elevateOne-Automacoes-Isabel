import { NextResponse } from "next/server";

/**
 * A saúde da app, para o proxy e os alertas: responde 200 se o banco responde, 503 se não.
 * Não diz mais nada: é uma rota pública.
 */
export class HealthController {
  constructor(private readonly pingDatabase: () => Promise<unknown>) {}

  async check() {
    try {
      await this.pingDatabase();
      return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      console.error(error);
      return NextResponse.json(
        { ok: false },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
  }
}
