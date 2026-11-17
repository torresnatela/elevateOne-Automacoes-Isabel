"use client";

import { useRef, useState, type FormEvent } from "react";

export interface KnowledgeDocumentView {
  id: string;
  title: string;
  fileName: string;
  size: number;
  chunkCount: number;
  createdAt: string;
}

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-PT", { day: "2-digit", month: "short", year: "numeric" });

async function messageOf(res: Response, fallback: string) {
  const data = await res.json().catch(() => null);
  return data?.error?.message ?? fallback;
}

/** A base de conhecimento, para o admin: enviar, ver e apagar ficheiros. */
export function KnowledgeManager({
  initialDocuments,
}: {
  initialDocuments: KnowledgeDocumentView[];
}) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const res = await fetch("/api/admin/knowledge/documents", {
        method: "POST",
        body: new FormData(e.currentTarget),
      });
      if (!res.ok) {
        setError(await messageOf(res, "Não foi possível enviar o ficheiro."));
        return;
      }
      const { document } = await res.json();
      setDocuments((list) => [document, ...list]);
      form.current?.reset();
    } catch {
      setError("Não foi possível ligar ao servidor. Tente novamente.");
    } finally {
      setSending(false);
    }
  }

  async function remove(doc: KnowledgeDocumentView) {
    if (!window.confirm(`Apagar «${doc.title}» da base de conhecimento?`)) return;
    setError(null);
    setRemoving(doc.id);
    try {
      const res = await fetch(`/api/admin/knowledge/documents/${doc.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        setError(await messageOf(res, "Não foi possível apagar o ficheiro."));
        return;
      }
      setDocuments((list) => list.filter((d) => d.id !== doc.id));
    } catch {
      setError("Não foi possível ligar ao servidor. Tente novamente.");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="stack">
      <form ref={form} className="panel form" onSubmit={onSubmit}>
        <label htmlFor="file">Ficheiro (PDF, DOCX, TXT ou MD, até 25 MB)</label>
        <input id="file" name="file" type="file" accept=".pdf,.docx,.txt,.md" required />

        <label htmlFor="title">Título (opcional)</label>
        <input id="title" name="title" type="text" placeholder="O nome que a equipa vê" />

        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" disabled={sending}>
          {sending ? "A enviar e a ler o ficheiro…" : "Enviar"}
        </button>
      </form>

      {documents.length === 0 ? (
        <p className="muted">Ainda não há ficheiros. O chat só responde com o que estiver aqui.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Título</th>
              <th>Ficheiro</th>
              <th>Tamanho</th>
              <th>Pedaços</th>
              <th>Enviado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id}>
                <td>{doc.title}</td>
                <td className="muted">{doc.fileName}</td>
                <td>{formatSize(doc.size)}</td>
                <td>{doc.chunkCount}</td>
                <td>{formatDate(doc.createdAt)}</td>
                <td>
                  <button
                    type="button"
                    className="link danger"
                    disabled={removing === doc.id}
                    onClick={() => remove(doc)}
                    aria-label={`Apagar ${doc.title}`}
                  >
                    {removing === doc.id ? "A apagar…" : "Apagar"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
