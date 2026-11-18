"use client";

import { useRef, useState, type FormEvent } from "react";
import { Icon } from "@/views/components/Icon";

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
  /** O nome do ficheiro escolhido, para o mostrar no lugar do convite. */
  const [chosen, setChosen] = useState<string | null>(null);
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
      setChosen(null);
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
    <>
      <form ref={form} className="cartao formulario" onSubmit={onSubmit}>
        <div className="colunas" style={{ alignItems: "flex-end" }}>
          <div className="campo largo">
            <label className="campo-rotulo" htmlFor="file">
              Ficheiro
            </label>
            <input
              className="so-leitor"
              id="file"
              name="file"
              type="file"
              accept=".pdf,.docx,.txt,.md"
              required
              onChange={(e) => setChosen(e.target.files?.[0]?.name ?? null)}
            />
            <label className="largar" htmlFor="file">
              <span className="ladrilho" aria-hidden="true">
                <Icon name="carregar" />
              </span>
              <span className="largar-textos">
                <span className="largar-nome">{chosen ?? "Escolher um ficheiro"}</span>
                <span className="ajuda">PDF, DOCX, TXT ou MD, até 25 MB</span>
              </span>
            </label>
          </div>

          <div className="campo">
            <label className="campo-rotulo" htmlFor="title">
              Título (opcional)
            </label>
            <input
              className="entrada"
              id="title"
              name="title"
              type="text"
              placeholder="O nome que a equipa vê"
              style={{ height: 64 }}
            />
          </div>

          <button
            type="submit"
            className="botao primario grande"
            disabled={sending}
            style={{ flex: "0 0 auto", height: 64, paddingInline: 24 }}
          >
            {sending ? "A enviar e a ler o ficheiro…" : "Enviar"}
          </button>
        </div>

        {error && (
          <p role="alert" className="mensagem erro">
            {error}
          </p>
        )}
      </form>

      {documents.length === 0 ? (
        <div className="cartao">
          <div className="vazio">
            <span className="ladrilho" aria-hidden="true">
              <Icon name="livro" />
            </span>
            <p className="vazio-titulo">A base está vazia</p>
            <p>Ainda não há ficheiros. O chat só responde com o que estiver aqui.</p>
          </div>
        </div>
      ) : (
        <div className="moldura-tabela">
          <table className="tabela">
            <thead>
              <tr>
                <th>Título</th>
                <th>Ficheiro</th>
                <th>Tamanho</th>
                <th>Pedaços</th>
                <th>Enviado</th>
                <th>
                  <span className="so-leitor">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td className="forte">{doc.title}</td>
                  <td>{doc.fileName}</td>
                  <td className="num">{formatSize(doc.size)}</td>
                  <td className="num">{doc.chunkCount}</td>
                  <td className="num">{formatDate(doc.createdAt)}</td>
                  <td className="acoes">
                    <button
                      type="button"
                      className="botao fantasma perigo so-icone"
                      disabled={removing === doc.id}
                      onClick={() => remove(doc)}
                      aria-label={`Apagar ${doc.title}`}
                      title="Apagar"
                    >
                      <Icon name="apagar" small />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
