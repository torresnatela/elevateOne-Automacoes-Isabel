"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Markdown from "react-markdown";
import { BrandMark } from "@/views/components/BrandMark";
import { Icon } from "@/views/components/Icon";
import { readNdjson } from "@/views/lib/ndjson";

export interface ConversationView {
  id: string;
  title: string;
}

interface MessageView {
  id: string;
  role: "USER" | "ASSISTANT";
  text: string;
}

type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; statusText: string | null }
  | { type: "done"; text: string }
  | { type: "error"; message: string };

const CONNECTION_ERROR = "Não foi possível ligar ao servidor. Tente novamente.";
const AGENT_NAME = "Assistente interno";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message ?? "Algo correu mal.");
  return data as T;
}

/** Uma resposta do agente: o seu símbolo, o nome e o texto (ou o que está a fazer). */
function Answer({ children }: { children: React.ReactNode }) {
  return (
    <div className="resposta">
      <BrandMark size="pequeno" />
      <div className="resposta-corpo">
        <p className="resposta-autor">{AGENT_NAME}</p>
        {children}
      </div>
    </div>
  );
}

/** O chat interno: as conversas à esquerda, a conversa aberta e a caixa de escrever à direita. */
export function ChatView({ initialConversations }: { initialConversations: ConversationView[] }) {
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [draft, setDraft] = useState("");
  /** A resposta a chegar: o texto até agora e o que o agente está a fazer. */
  const [answering, setAnswering] = useState<{ text: string; status: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [messages, answering]);

  // A caixa cresce com o texto, até ao máximo do CSS.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const title = conversations.find((c) => c.id === activeId)?.title ?? "Nova conversa";

  async function open(id: string) {
    if (answering) return;
    setError(null);
    setActiveId(id);
    setMessages([]);
    try {
      const data = await api<{ messages: MessageView[] }>(`/api/chat/conversations/${id}/messages`);
      setMessages(data.messages);
    } catch (e) {
      setError(e instanceof TypeError ? CONNECTION_ERROR : (e as Error).message);
    }
  }

  function startNew() {
    if (answering) return;
    setActiveId(null);
    setMessages([]);
    setError(null);
    box.current?.focus();
  }

  async function remove(conversation: ConversationView) {
    if (answering || !window.confirm(`Apagar a conversa «${conversation.title}»?`)) return;
    try {
      await api(`/api/chat/conversations/${conversation.id}`, { method: "DELETE" });
      setConversations((list) => list.filter((c) => c.id !== conversation.id));
      if (activeId === conversation.id) startNew();
    } catch (e) {
      setError(e instanceof TypeError ? CONNECTION_ERROR : (e as Error).message);
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || answering) return;
    setError(null);
    setDraft("");
    setMessages((list) => [...list, { id: `local-${Date.now()}`, role: "USER", text }]);
    setAnswering({ text: "", status: null });

    try {
      let id = activeId;
      if (!id) {
        const data = await api<{ conversation: ConversationView }>("/api/chat/conversations", {
          method: "POST",
        });
        id = data.conversation.id;
        setActiveId(id);
      }

      const res = await fetch(`/api/chat/conversations/${id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message ?? "Não foi possível enviar a mensagem.");
      }

      let finished = false;
      await readNdjson<StreamEvent>(res.body, (event) => {
        if (event.type === "delta") {
          setAnswering((a) => ({ text: (a?.text ?? "") + event.text, status: null }));
        } else if (event.type === "tool") {
          // O que escreveu até aqui era um aparte antes de ir procurar: a resposta vem a seguir.
          setAnswering({ text: "", status: event.statusText ?? "A trabalhar…" });
        } else if (event.type === "done") {
          finished = true;
          setMessages((list) => [
            ...list,
            { id: `local-${Date.now()}-a`, role: "ASSISTANT", text: event.text },
          ]);
        } else {
          finished = true;
          setError(event.message);
        }
      });
      if (!finished) setError("A resposta foi interrompida. Tente novamente.");

      const data = await api<{ conversations: ConversationView[] }>("/api/chat/conversations");
      setConversations(data.conversations);
    } catch (e) {
      setError(e instanceof TypeError ? CONNECTION_ERROR : (e as Error).message);
    } finally {
      setAnswering(null);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="chat">
      <aside className="chat-lista" aria-label="Conversas">
        <button
          type="button"
          className="botao primario grande largo"
          onClick={startNew}
          disabled={!!answering}
        >
          <Icon name="mais" />
          Nova conversa
        </button>
        {conversations.length > 0 && <p className="rotulo">Conversas</p>}
        <ul>
          {conversations.map((c) => (
            <li key={c.id} className={c.id === activeId ? "conversa aberta" : "conversa"}>
              <button
                type="button"
                className="conversa-abrir"
                aria-current={c.id === activeId ? "true" : undefined}
                onClick={() => open(c.id)}
              >
                {c.title}
              </button>
              <button
                type="button"
                className="botao fantasma perigo so-icone conversa-apagar"
                aria-label={`Apagar a conversa ${c.title}`}
                title="Apagar"
                onClick={() => remove(c)}
              >
                <Icon name="apagar" small />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="chat-principal" aria-label="Conversa aberta">
        <header className="chat-cabeca">
          <h1 className="chat-titulo">{title}</h1>
          {answering && (
            <span className="estado trabalho">
              <span className="ponto vivo" />
              <span>{AGENT_NAME} a responder</span>
            </span>
          )}
        </header>

        <div className="chat-mensagens" aria-live="polite">
          <div className="chat-fio">
            {messages.length === 0 && !answering && (
              <div className="vazio chat-vazio">
                <span className="ladrilho" aria-hidden="true">
                  <Icon name="chat" />
                </span>
                <p className="vazio-titulo">Em que posso ajudar?</p>
                <p>
                  Pergunte o que precisar: um procedimento do escritório, uma dúvida fiscal, um
                  email para rever. As respostas vêm da base de conhecimento do escritório, quando
                  ela cobre o assunto.
                </p>
              </div>
            )}
            {messages.map((m) =>
              m.role === "USER" ? (
                <p key={m.id} className="bubble">
                  {m.text}
                </p>
              ) : (
                <Answer key={m.id}>
                  <div className="prosa">
                    <Markdown>{m.text}</Markdown>
                  </div>
                </Answer>
              ),
            )}
            {answering && (
              <Answer>
                {answering.text ? (
                  <div className="prosa">
                    <Markdown>{answering.text}</Markdown>
                  </div>
                ) : (
                  <span className="estado trabalho" role="status">
                    <span className="ponto vivo" />
                    <span>{answering.status ?? "A pensar…"}</span>
                  </span>
                )}
              </Answer>
            )}
            {error && (
              <p role="alert" className="mensagem erro">
                {error}
              </p>
            )}
            <div ref={end} />
          </div>
        </div>

        <form className="chat-compor" onSubmit={onSubmit}>
          <div className="compositor">
            <textarea
              ref={box}
              aria-label="Mensagem"
              placeholder="Escreva a sua pergunta…"
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button
              type="submit"
              className="botao primario grande so-icone"
              aria-label="Enviar"
              title="Enviar"
              disabled={!!answering || !draft.trim()}
            >
              <Icon name="enviar" />
            </button>
          </div>
          <p className="chat-dica">
            Enter envia · Shift+Enter muda de linha · As respostas vêm da base de conhecimento do
            escritório
          </p>
        </form>
      </section>
    </div>
  );
}
