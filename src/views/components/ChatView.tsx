"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Markdown from "react-markdown";
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

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message ?? "Algo correu mal.");
  return data as T;
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

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [messages, answering]);

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
      <aside className="chat-list" aria-label="Conversas">
        <button type="button" onClick={startNew} disabled={!!answering}>
          Nova conversa
        </button>
        <ul>
          {conversations.map((c) => (
            <li key={c.id} className={c.id === activeId ? "active" : undefined}>
              <button type="button" className="link chat-open" onClick={() => open(c.id)}>
                {c.title}
              </button>
              <button
                type="button"
                className="link danger"
                aria-label={`Apagar a conversa ${c.title}`}
                onClick={() => remove(c)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="chat-main">
        <div className="chat-messages" aria-live="polite">
          {messages.length === 0 && !answering && (
            <p className="muted chat-empty">
              Pergunte o que precisar: um procedimento do escritório, uma dúvida fiscal, um email
              para rever. As respostas vêm da base de conhecimento do escritório, quando ela cobre o
              assunto.
            </p>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`bubble ${m.role === "USER" ? "mine" : "theirs"}`}>
              {m.role === "USER" ? m.text : <Markdown>{m.text}</Markdown>}
            </div>
          ))}
          {answering && (
            <div className="bubble theirs">
              {answering.text ? (
                <Markdown>{answering.text}</Markdown>
              ) : (
                <span className="muted" role="status">
                  {answering.status ?? "A pensar…"}
                </span>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div ref={end} />
        </div>

        <form className="chat-composer" onSubmit={onSubmit}>
          <textarea
            aria-label="Mensagem"
            placeholder="Escreva a sua pergunta…"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="submit" disabled={!!answering || !draft.trim()}>
            Enviar
          </button>
        </form>
      </section>
    </div>
  );
}
