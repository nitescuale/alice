import { useRef, useState } from "react";
import Markdown from "react-markdown";
import {
  MessageSquare,
  AlertCircle,
  Send,
  Bot,
  User,
  Trash2,
  ChevronDown,
} from "lucide-react";
import { api } from "../api";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------

export function Interviews() {
  const [problem, setProblem] = useState("");
  const [company, setCompany] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    setErr("");
    setInput("");

    const newMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages(newMessages);
    setLoading(true);
    scrollToBottom();

    try {
      const r = await api<{ reply: string }>("/api/interview/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: newMessages,
          problem: problem.trim() || null,
          company: company.trim() || null,
        }),
      });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: r.reply },
      ]);
      scrollToBottom();
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  function clearChat() {
    setMessages([]);
    setErr("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const hasContext = problem.trim().length > 0;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Interviews</h1>
        <p className="page-header__subtitle">
          Simulez un entretien technique avec un intervieweur IA. Partagez un
          enonce ou commencez directement — l'IA guide, questionne et evalue.
        </p>
      </div>

      {err && (
        <div className="error-banner">
          <span className="error-banner__icon">
            <AlertCircle size={16} />
          </span>
          {err}
        </div>
      )}

      <div className="interviews-layout">
        {/* Left panel — Context */}
        <div className="interviews-panel">
          <div className="interviews-panel__header">
            <MessageSquare size={18} style={{ color: "var(--amber-400)" }} />
            <span className="interviews-panel__title">Contexte</span>
          </div>

          <div
            className="alice-input-group"
            style={{ marginBottom: "var(--sp-4)" }}
          >
            <label className="alice-input-group__label">
              Entreprise / dossier (optionnel)
            </label>
            <input
              className="alice-input"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="ex : google, meta..."
            />
            <span className="alice-input-group__hint">
              Filtre les problemes RAG par entreprise
            </span>
          </div>

          <div className="alice-input-group">
            <label className="alice-input-group__label">
              Enonce du probleme (optionnel)
            </label>
            <textarea
              className="alice-textarea"
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              placeholder="Collez l'enonce ou decrivez le probleme. L'IA ajustera son contexte RAG en consequence."
              rows={10}
            />
            {hasContext && (
              <span
                className="alice-input-group__hint"
                style={{ color: "var(--success-500)" }}
              >
                Contexte RAG actif
              </span>
            )}
          </div>

          <div
            style={{
              marginTop: "var(--sp-4)",
              padding: "var(--sp-3)",
              background: "rgba(212, 160, 74, 0.06)",
              borderRadius: "var(--radius-md)",
              border: "1px solid rgba(212, 160, 74, 0.15)",
            }}
          >
            <p
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--amber-400)",
                margin: "0 0 var(--sp-2)",
                fontWeight: 600,
              }}
            >
              Conseils
            </p>
            <ul
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--noir-400)",
                margin: 0,
                paddingLeft: "var(--sp-4)",
                lineHeight: "var(--leading-relaxed)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--sp-1)",
              }}
            >
              <li>Pensez a voix haute — l'intervieweur s'adapte.</li>
              <li>Posez des questions de clarification avant de coder.</li>
              <li>Partagez votre complexite algorithmique.</li>
              <li>Shift+Entree pour une nouvelle ligne dans le chat.</li>
            </ul>
          </div>
        </div>

        {/* Right panel — Chat */}
        <Card variant="default" padding="none" className="interview-chat">
          {/* Chat header */}
          <div
            style={{
              padding: "var(--sp-4) var(--sp-5)",
              borderBottom: "var(--border-subtle)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-2)",
              }}
            >
              <Bot size={16} style={{ color: "var(--amber-400)" }} />
              <span style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>
                Intervieweur IA
              </span>
              <Badge variant="amber" size="sm">
                Ollama Chat
              </Badge>
            </div>
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash2 size={12} />}
                onClick={clearChat}
              >
                Effacer
              </Button>
            )}
          </div>

          {/* Messages */}
          <div className="interview-chat__messages">
            {messages.length === 0 && (
              <div className="interview-chat__empty">
                <MessageSquare
                  size={40}
                  className="interview-chat__empty-icon"
                />
                <p style={{ fontSize: "var(--text-sm)" }}>
                  Commencez a parler — l'intervieweur vous guide.
                </p>
                <p
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--noir-500)",
                  }}
                >
                  Essayez : "Bonjour, je suis pret pour l'entretien."
                </p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`assistant-msg ${
                  msg.role === "user"
                    ? "assistant-msg--user"
                    : "assistant-msg--ai"
                }`}
              >
                <div
                  className={`assistant-msg__avatar ${
                    msg.role === "user"
                      ? "assistant-msg__avatar--user"
                      : "assistant-msg__avatar--ai"
                  }`}
                >
                  {msg.role === "user" ? (
                    <User size={14} />
                  ) : (
                    <Bot size={14} />
                  )}
                </div>
                <div className="assistant-msg__bubble">
                  {msg.role === "assistant" ? (
                    <div className="md-content">
                      <Markdown>{msg.content}</Markdown>
                    </div>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="assistant-msg assistant-msg--ai">
                <div className="assistant-msg__avatar assistant-msg__avatar--ai">
                  <Bot size={14} />
                </div>
                <div className="assistant-msg__bubble">
                  <div style={{ display: "flex", gap: "var(--sp-1)" }}>
                    <span style={{ animation: "pulse 1.2s ease infinite" }}>
                      .
                    </span>
                    <span
                      style={{
                        animation: "pulse 1.2s ease infinite 0.2s",
                      }}
                    >
                      .
                    </span>
                    <span
                      style={{
                        animation: "pulse 1.2s ease infinite 0.4s",
                      }}
                    >
                      .
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Scroll hint when messages overflow */}
          {messages.length > 3 && (
            <div
              style={{
                position: "absolute",
                bottom: 80,
                right: "var(--sp-4)",
                opacity: 0.4,
                pointerEvents: "none",
              }}
            >
              <ChevronDown size={16} />
            </div>
          )}

          {/* Input */}
          <div
            style={{
              padding: "var(--sp-3) var(--sp-4)",
              borderTop: "var(--border-subtle)",
              display: "flex",
              gap: "var(--sp-3)",
              alignItems: "flex-end",
            }}
          >
            <textarea
              className="alice-textarea"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Votre reponse… (Entree pour envoyer, Shift+Entree pour nouvelle ligne)"
              rows={2}
              style={{ flex: 1, minHeight: 56, resize: "none" }}
              disabled={loading}
            />
            <Button
              variant="primary"
              size="md"
              icon={<Send size={14} />}
              disabled={loading || !input.trim()}
              loading={loading}
              onClick={sendMessage}
            >
              Envoyer
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
