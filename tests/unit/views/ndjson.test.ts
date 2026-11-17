import { readNdjson } from "@/views/lib/ndjson";

function streamOf(...chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe("readNdjson", () => {
  it("junta as linhas e os caracteres partidos entre bocados", async () => {
    const bytes = new TextEncoder().encode('{"t":"olá"}\n{"t":"é 23 %"}\n{"t":"fim"}');
    // Corta a meio do «á» (2 bytes) e a meio de uma linha.
    const events: unknown[] = [];
    await readNdjson(streamOf(bytes.slice(0, 9), bytes.slice(9, 20), bytes.slice(20)), (e) =>
      events.push(e),
    );
    expect(events).toEqual([{ t: "olá" }, { t: "é 23 %" }, { t: "fim" }]);
  });

  it("ignora linhas vazias", async () => {
    const events: unknown[] = [];
    await readNdjson(streamOf(new TextEncoder().encode('\n{"a":1}\n\n')), (e) => events.push(e));
    expect(events).toEqual([{ a: 1 }]);
  });
});
