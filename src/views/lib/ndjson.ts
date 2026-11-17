/**
 * Lê uma resposta em NDJSON (uma linha de JSON por evento) à medida que chega. Os
 * bocados da rede não respeitam as linhas (nem os caracteres): junta-os primeiro.
 */
export async function readNdjson<T>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: T) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const flush = (final: boolean) => {
    const lines = pending.split("\n");
    pending = final ? "" : (lines.pop() ?? "");
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as T);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    flush(false);
  }
  pending += decoder.decode();
  flush(true);
}
