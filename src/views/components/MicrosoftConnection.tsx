"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Icon } from "@/views/components/Icon";

export interface MicrosoftStatusView {
  connected: boolean;
  email: string | null;
  missingScopes: string[];
  folder: { driveId: string; itemId: string; name: string; webUrl: string | null } | null;
}

interface ItemView {
  id: string;
  name: string;
  isFolder: boolean;
  webUrl: string | null;
}

const RESULTS: Record<string, { error: boolean; text: string }> = {
  ligado: { error: false, text: "Conta Microsoft ligada. Agora escolha a pasta da empresa." },
  recusado: { error: true, text: "A autorização foi recusada na Microsoft. Nada foi ligado." },
  "precisa-admin": {
    error: true,
    text: "A sua empresa exige que um administrador do Microsoft 365 aprove este sistema primeiro. Fale com quem gere as contas Microsoft.",
  },
  erro: { error: true, text: "Não foi possível ligar a conta Microsoft. Tente novamente." },
  "por-configurar": {
    error: true,
    text: "A ligação à Microsoft ainda não está configurada neste sistema. Fale com o administrador.",
  },
};

/** A conta Microsoft (OneDrive) de quem está a ver: ligar, escolher a pasta da empresa, desligar. */
export function MicrosoftConnection({
  status,
  result,
}: {
  status: MicrosoftStatusView;
  result?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [editing, setEditing] = useState(!status.folder);
  const [items, setItems] = useState<ItemView[] | null>(null);
  const outcome = result ? RESULTS[result] : undefined;

  async function call(url: string, init: RequestInit) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message ?? "Não foi possível concluir.");
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function chooseFolder(e: FormEvent) {
    e.preventDefault();
    const data = await call("/api/microsoft/folder", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ link }),
    });
    if (!data) return;
    setItems(data.items);
    setEditing(false);
    setLink("");
    router.refresh();
  }

  async function showItems() {
    const data = await call("/api/microsoft/folder", { method: "GET" });
    if (data) setItems(data.items);
  }

  async function disconnect() {
    if (!window.confirm("Desligar a conta Microsoft? Os agentes deixam de chegar ao OneDrive."))
      return;
    const data = await call("/api/microsoft", { method: "DELETE" });
    if (!data) return;
    router.replace("/integracoes");
    router.refresh();
  }

  return (
    <section className="cartao" style={{ gap: 20, padding: 24 }}>
      <div className="cartao-cabeca">
        <span className="ladrilho" aria-hidden="true">
          <Icon name="documento" />
        </span>
        <div className="cartao-textos">
          <h2 className="cartao-titulo">Microsoft OneDrive</h2>
          <p className="cartao-desc">
            {status.connected ? (
              <>
                Ligada como <strong>{status.email}</strong>
              </>
            ) : (
              "A pasta do OneDrive onde a empresa organiza os documentos."
            )}
          </p>
        </div>
        {status.connected ? (
          <span
            className={
              status.missingScopes.length > 0 || !status.folder ? "estado aviso" : "estado sucesso"
            }
          >
            <span className="ponto" />
            <span>
              {status.missingScopes.length > 0
                ? "Faltam permissões"
                : status.folder
                  ? "Ligada"
                  : "Falta a pasta"}
            </span>
          </span>
        ) : (
          <span className="estado neutro">
            <span className="ponto" />
            <span>Por ligar</span>
          </span>
        )}
      </div>

      {outcome && (
        <p
          role={outcome.error ? "alert" : "status"}
          className={outcome.error ? "mensagem erro" : "mensagem sucesso"}
        >
          {outcome.text}
        </p>
      )}
      {error && (
        <p role="alert" className="mensagem erro">
          {error}
        </p>
      )}

      {status.connected ? (
        <>
          {status.missingScopes.length > 0 && (
            <div className="mensagem aviso cartao-cabeca">
              <span style={{ flex: "1 1 280px" }}>
                A conta foi ligada sem acesso aos ficheiros. Ligue de novo e aceite as permissões.
              </span>
              <a className="botao primario" href="/api/microsoft/connect">
                Dar as permissões
              </a>
            </div>
          )}

          <div className="campo">
            <h3 className="rotulo">Pasta da empresa</h3>
            {status.folder && !editing ? (
              <div className="cartao-pe">
                <p className="cartao-desc" style={{ flex: "1 1 280px" }}>
                  <strong>{status.folder.name}</strong>
                  {status.folder.webUrl && (
                    <>
                      {" · "}
                      <a href={status.folder.webUrl} target="_blank" rel="noreferrer">
                        abrir no OneDrive
                      </a>
                    </>
                  )}
                </p>
                <button type="button" className="botao" disabled={busy} onClick={showItems}>
                  Ver o que lá está
                </button>
                <button
                  type="button"
                  className="botao fantasma"
                  disabled={busy}
                  onClick={() => setEditing(true)}
                >
                  Trocar
                </button>
              </div>
            ) : (
              <form onSubmit={chooseFolder} className="campo">
                <label className="campo-rotulo" htmlFor="onedrive-link">
                  Link de partilha da pasta (no OneDrive: botão «Partilhar» → «Copiar link»), ou o
                  caminho dela no seu OneDrive (ex.: <code>Empresa/Documentos</code>).
                </label>
                <input
                  id="onedrive-link"
                  className="entrada"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://…sharepoint.com/:f:/… ou Empresa/Documentos"
                  required
                />
                <div className="cartao-pe">
                  {status.folder && (
                    <button
                      type="button"
                      className="botao fantasma"
                      disabled={busy}
                      onClick={() => setEditing(false)}
                    >
                      Cancelar
                    </button>
                  )}
                  <button type="submit" className="botao primario" disabled={busy || !link.trim()}>
                    {busy ? "A procurar…" : "Usar esta pasta"}
                  </button>
                </div>
              </form>
            )}
          </div>

          {items && (
            <div className="campo">
              <h3 className="rotulo">
                {items.length === 0
                  ? "A pasta está vazia."
                  : `O que os agentes veem na pasta (${items.length}${items.length === 50 ? "+" : ""})`}
              </h3>
              <ul className="permissoes">
                {items.map((item) => (
                  <li key={item.id}>
                    <span className="dada">
                      <Icon name={item.isFolder ? "livro" : "documento"} small />
                    </span>
                    {item.webUrl ? (
                      <a href={item.webUrl} target="_blank" rel="noreferrer">
                        {item.name}
                      </a>
                    ) : (
                      <span>{item.name}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="cartao-pe">
            <p className="cartao-desc" style={{ flex: "1 1 320px" }}>
              Os agentes só leem dentro da pasta escolhida, com as permissões desta conta.
            </p>
            <button
              type="button"
              className="botao fantasma perigo"
              disabled={busy}
              onClick={disconnect}
            >
              Desligar
            </button>
          </div>
        </>
      ) : (
        <div className="cartao-pe">
          <p className="cartao-desc" style={{ flex: "1 1 320px" }}>
            Ligue a conta Microsoft (de empresa ou pessoal) que tem acesso à pasta da empresa.
          </p>
          <a className="botao primario grande" href="/api/microsoft/connect">
            Ligar conta Microsoft
          </a>
        </div>
      )}
    </section>
  );
}
