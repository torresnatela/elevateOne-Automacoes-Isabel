import { KeyedQueue } from "@/server/lib/keyed-queue";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("KeyedQueue", () => {
  it("corre uma de cada vez por chave, pela ordem de chegada", async () => {
    const queue = new KeyedQueue();
    const log: string[] = [];
    const task = (name: string, ms: number) => async () => {
      log.push(`início ${name}`);
      await sleep(ms);
      log.push(`fim ${name}`);
      return name;
    };

    const results = await Promise.all([
      queue.run("a", task("1", 20)),
      queue.run("a", task("2", 1)),
    ]);

    expect(results).toEqual(["1", "2"]);
    expect(log).toEqual(["início 1", "fim 1", "início 2", "fim 2"]);
  });

  it("chaves diferentes não esperam umas pelas outras", async () => {
    const queue = new KeyedQueue();
    const log: string[] = [];
    await Promise.all([
      queue.run("a", async () => {
        await sleep(20);
        log.push("a");
      }),
      queue.run("b", async () => {
        log.push("b");
      }),
    ]);
    expect(log).toEqual(["b", "a"]);
  });

  it("uma tarefa que falha não trava as seguintes", async () => {
    const queue = new KeyedQueue();
    const first = queue.run("a", async () => {
      throw new Error("falhou");
    });
    const second = queue.run("a", async () => "ok");

    await expect(first).rejects.toThrow("falhou");
    await expect(second).resolves.toBe("ok");
  });
});
