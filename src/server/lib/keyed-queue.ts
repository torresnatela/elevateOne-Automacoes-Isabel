/**
 * Corre uma tarefa de cada vez por chave (as mensagens de um mesmo número, por
 * exemplo), pela ordem em que chegam. Chaves diferentes correm em paralelo.
 * Vale dentro de um processo: com várias instâncias da app, é preciso outra coisa.
 */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }
}
