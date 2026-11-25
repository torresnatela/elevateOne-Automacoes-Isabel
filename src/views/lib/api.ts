const CONNECTION_ERROR = "Não foi possível ligar ao servidor. Tente novamente.";

/** Chama a API em JSON e devolve os dados, ou lança a mensagem de erro que ela deu. */
export async function api<T>(url: string, method: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(CONNECTION_ERROR);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const details = Object.values((data?.error?.details ?? {}) as Record<string, string[]>).flat();
    throw new Error(details[0] ?? data?.error?.message ?? "Algo correu mal.");
  }
  return data as T;
}
