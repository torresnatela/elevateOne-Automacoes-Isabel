import { PrismaAgentEventRepository } from "@/server/repositories/agent-event.repository";
import { prisma, resetDatabase } from "../setup/db";

const repo = new PrismaAgentEventRepository(prisma);

describe("PrismaAgentEventRepository", () => {
  beforeEach(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it("guarda uma tarefa feita e uma mudança de estado", async () => {
    const done = await repo.create({
      agent: "eva",
      state: "WORKING",
      type: "marcacao",
      text: "Marcou uma reunião",
      tool: "calendar",
      minutes: 5,
    });
    const idle = await repo.create({ agent: "eva", state: "IDLE", text: "Disponível" });

    expect(done).toMatchObject({ type: "marcacao", tool: "calendar", minutes: 5 });
    expect(idle).toMatchObject({ type: null, tool: null, minutes: 0 });
    expect(idle.seq).toBeGreaterThan(done.seq);
  });

  it("lista por ordem os eventos depois de um número, até ao limite", async () => {
    const first = await repo.create({ agent: "eva", state: "WORKING", text: "1" });
    await repo.create({ agent: "eva", state: "WORKING", text: "2" });
    await repo.create({ agent: "eva", state: "WORKING", text: "3" });
    await repo.create({ agent: "eva", state: "IDLE", text: "4" });

    const events = await repo.listAfter(first.seq, 2);
    expect(events.map((e) => e.text)).toEqual(["2", "3"]);
    await expect(repo.listAfter(0, 10)).resolves.toHaveLength(4);
  });

  it("com um instante, só devolve os eventos a partir dele", async () => {
    const old = await repo.create({ agent: "eva", state: "WORKING", text: "ontem" });
    await prisma.agentEvent.update({
      where: { id: old.id },
      data: { createdAt: new Date("2026-01-01T00:00:00Z") },
    });
    await repo.create({ agent: "eva", state: "WORKING", text: "hoje" });

    const events = await repo.listAfter(0, 10, new Date("2026-06-01T00:00:00Z"));
    expect(events.map((e) => e.text)).toEqual(["hoje"]);
  });
});
