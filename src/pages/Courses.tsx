import { useCallback, useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import {
  ChevronRight,
  BookOpen,
  FileText,
  Send,
  AlertCircle,
  RefreshCw,
  Bot,
  User,
  ChevronLeft,
  Trash2,
} from "lucide-react";
import { api } from "../api";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";

type Chapter = { id: string; title: string; path?: string };
type Subject = { id: string; title: string; chapters: Chapter[] };

interface ChatMessage {
  role: "user" | "ai";
  text: string;
}

export function Courses() {
  const [tax, setTax] = useState<{ subjects: Subject[] } | null>(null);
  const [openSubjects, setOpenSubjects] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<{
    subjectId: string;
    chapterId: string;
  } | null>(null);
  const [content, setContent] = useState<{
    markdown: string;
    files: { path: string }[];
  } | null>(null);
  const [assistQ, setAssistQ] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [indexMsg, setIndexMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    api<{ subjects: Subject[] }>("/api/taxonomy")
      .then((t) => {
        setTax(t);
        setOpenSubjects(new Set(t.subjects.map((s) => s.id)));
      })
      .catch((e: Error) => setErr(String(e.message)));
  }, []);

  const loadChapter = useCallback(
    async (subjectId: string, chapterId: string) => {
      setSel({ subjectId, chapterId });
      setErr("");
      setLoading(true);
      setChatHistory([]);
      try {
        const c = await api<{ markdown: string; files: { path: string }[] }>(
          "/api/chapter/content",
          {
            method: "POST",
            body: JSON.stringify({
              subject_id: subjectId,
              chapter_id: chapterId,
            }),
          }
        );
        setContent(c);
        await api(
          "/api/progress/chapter/" + encodeURIComponent(chapterId),
          { method: "POST" }
        );
      } catch (e) {
        setErr(String(e));
        setContent(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  function toggleSubject(id: string) {
    setOpenSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function getAdjacentChapters() {
    if (!tax || !sel) return { prev: null, next: null };
    const allChapters: { subjectId: string; chapter: Chapter }[] = [];
    for (const s of tax.subjects) {
      for (const ch of s.chapters) {
        allChapters.push({ subjectId: s.id, chapter: ch });
      }
    }
    const idx = allChapters.findIndex((c) => c.chapter.id === sel.chapterId);
    return {
      prev: idx > 0 ? allChapters[idx - 1] : null,
      next: idx < allChapters.length - 1 ? allChapters[idx + 1] : null,
    };
  }

  async function runAssist() {
    if (!sel || !assistQ.trim()) return;
    const question = assistQ.trim();
    setAssistQ("");
    setChatHistory((prev) => [...prev, { role: "user", text: question }]);
    setErr("");
    setLoading(true);
    try {
      const r = await api<{ answer: string }>("/api/assist", {
        method: "POST",
        body: JSON.stringify({
          question,
          subject_id: sel.subjectId,
          chapter_id: sel.chapterId,
        }),
      });
      setChatHistory((prev) => [...prev, { role: "ai", text: r.answer }]);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function deleteSubject(subjectId: string, subjectTitle: string, chapterCount: number) {
    const warning = chapterCount > 0
      ? `Supprimer « ${subjectTitle} » et ses ${chapterCount} chapitre${chapterCount > 1 ? "s" : ""} ? Cette action est irréversible.`
      : `Supprimer la matière vide « ${subjectTitle} » ?`;
    if (!confirm(warning)) return;
    setErr("");
    try {
      await api("/api/subjects/delete", {
        method: "POST",
        body: JSON.stringify({ subject_id: subjectId }),
      });
      const t = await api<{ subjects: Subject[] }>("/api/taxonomy");
      setTax(t);
      setOpenSubjects(new Set(t.subjects.map((s) => s.id)));
      if (sel?.subjectId === subjectId) {
        setSel(null);
        setContent(null);
      }
    } catch (e) {
      setErr(String(e));
    }
  }

  async function deleteChapter(subjectId: string, chapterId: string, chapterTitle: string) {
    if (!confirm(`Supprimer « ${chapterTitle} » ? Cette action est irréversible.`)) return;
    setErr("");
    try {
      await api("/api/chapters/delete", {
        method: "POST",
        body: JSON.stringify({ subject_id: subjectId, chapter_id: chapterId }),
      });
      const t = await api<{ subjects: Subject[] }>("/api/taxonomy");
      setTax(t);
      setOpenSubjects(new Set(t.subjects.map((s) => s.id)));
      if (sel?.chapterId === chapterId) {
        setSel(null);
        setContent(null);
      }
    } catch (e) {
      setErr(String(e));
    }
  }

  async function rebuildIndex() {
    setIndexMsg("");
    setErr("");
    try {
      const r = await api<Record<string, unknown>>("/api/index/rebuild", {
        method: "POST",
        body: JSON.stringify({ interviews: true }),
      });
      const chunks = Number(r.chunks ?? 0);
      const files = Number(r.indexed_files ?? 0);
      setIndexMsg(`Indexation terminée — ${files} fichier${files > 1 ? "s" : ""}, ${chunks} chunk${chunks > 1 ? "s" : ""}`);
    } catch (e) {
      setErr(String(e));
    }
  }

  const { prev, next } = getAdjacentChapters();

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Cours</h1>
        <p className="page-header__subtitle">
          Parcourez vos matieres et chapitres. L'assistant RAG peut
          repondre a vos questions sur le contenu.
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

      <div className="courses-layout">
        {/* Tree navigation */}
        <Card variant="default" padding="sm" className="courses-tree">
          <div style={{ padding: "var(--sp-3) var(--sp-3) var(--sp-2)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--sp-3)" }}>
              <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--noir-300)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Arborescence
              </span>
              <Button variant="ghost" size="sm" icon={<RefreshCw size={12} />} onClick={rebuildIndex}>
                RAG
              </Button>
            </div>
            {indexMsg && (
              <pre style={{ fontSize: "0.7rem", whiteSpace: "pre-wrap", color: "var(--noir-400)", marginBottom: "var(--sp-3)" }}>
                {indexMsg}
              </pre>
            )}
          </div>

          {!tax && (
            <div style={{ padding: "var(--sp-4)" }}>
              <div className="skeleton skeleton--text" />
              <div className="skeleton skeleton--text" style={{ width: "60%" }} />
              <div className="skeleton skeleton--text" style={{ width: "70%" }} />
            </div>
          )}

          {tax?.subjects.map((s) => (
            <div key={s.id} className="tree-section">
              <div className="tree-subject-row">
                <button
                  type="button"
                  className="tree-subject"
                  onClick={() => toggleSubject(s.id)}
                >
                  <span
                    className={`tree-subject__icon ${openSubjects.has(s.id) ? "tree-subject__icon--open" : ""}`}
                  >
                    <ChevronRight size={14} />
                  </span>
                  <BookOpen size={14} />
                  {s.title}
                </button>
                <button
                  type="button"
                  className="tree-chapter__delete"
                  title="Supprimer la matière"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSubject(s.id, s.title, s.chapters?.length ?? 0);
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>

              {openSubjects.has(s.id) && (s.chapters?.length ?? 0) === 0 && (
                <div className="tree-chapter tree-chapter--empty">
                  <span style={{ opacity: 0.5, fontSize: "var(--text-xs)", fontStyle: "italic", padding: "0 var(--sp-2)" }}>
                    Aucun chapitre
                  </span>
                </div>
              )}

              {openSubjects.has(s.id) &&
                s.chapters?.map((ch) => (
                  <div key={ch.id} className="tree-chapter">
                    <button
                      type="button"
                      className={`tree-chapter__btn ${sel?.chapterId === ch.id ? "tree-chapter__btn--active" : ""}`}
                      onClick={() => loadChapter(s.id, ch.id)}
                    >
                      <span className="tree-chapter__dot" />
                      <FileText size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
                      {ch.title}
                    </button>
                    <button
                      type="button"
                      className="tree-chapter__delete"
                      title="Supprimer ce chapitre"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteChapter(s.id, ch.id, ch.title);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
            </div>
          ))}
        </Card>

        {/* Content area */}
        <div className="courses-content">
          {loading && !content && (
            <Card variant="default" padding="lg">
              <div className="skeleton skeleton--heading" />
              <div className="skeleton skeleton--text" />
              <div className="skeleton skeleton--text" style={{ width: "90%" }} />
              <div className="skeleton skeleton--text" style={{ width: "75%" }} />
              <div className="skeleton skeleton--block" style={{ marginTop: "var(--sp-4)" }} />
            </Card>
          )}

          {!content && !loading && (
            <Card variant="outlined" padding="lg" style={{ textAlign: "center", color: "var(--noir-400)" }}>
              <BookOpen size={40} style={{ opacity: 0.2, marginBottom: "var(--sp-4)" }} />
              <p style={{ fontSize: "var(--text-md)", fontWeight: 500, color: "var(--noir-300)" }}>
                Selectionnez un chapitre
              </p>
              <p style={{ fontSize: "var(--text-sm)" }}>
                Choisissez un chapitre dans l'arborescence pour afficher son contenu.
              </p>
            </Card>
          )}

          {content && (
            <div className="animate-fade-in">
              {content.files.length > 0 && (
                <div style={{ marginBottom: "var(--sp-4)", display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
                  {content.files.map((f) => (
                    <Badge key={f.path} variant="default" size="sm">
                      <FileText size={10} style={{ marginRight: 4 }} />
                      {f.path.split("/").pop() || f.path}
                    </Badge>
                  ))}
                </div>
              )}

              <Card variant="default" padding="lg">
                <div className="md-content">
                  <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{content.markdown}</Markdown>
                </div>
              </Card>

              {/* Prev / Next navigation */}
              <div className="courses-content__nav">
                {prev ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<ChevronLeft size={14} />}
                    onClick={() => loadChapter(prev.subjectId, prev.chapter.id)}
                  >
                    {prev.chapter.title}
                  </Button>
                ) : (
                  <span />
                )}
                {next ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => loadChapter(next.subjectId, next.chapter.id)}
                  >
                    {next.chapter.title}
                    <ChevronRight size={14} />
                  </Button>
                ) : (
                  <span />
                )}
              </div>

              {/* Assistant chat */}
              {sel && (
                <div className="assistant-section">
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", marginBottom: "var(--sp-4)" }}>
                    <Bot size={18} style={{ color: "var(--amber-400)" }} />
                    <h3 style={{ fontSize: "var(--text-lg)", margin: 0 }}>
                      Assistant RAG
                    </h3>
                    <Badge variant="amber" size="sm">Ollama</Badge>
                  </div>

                  {chatHistory.length > 0 && (
                    <div className="assistant-messages">
                      {chatHistory.map((msg, i) => (
                        <div
                          key={i}
                          className={`assistant-msg ${msg.role === "user" ? "assistant-msg--user" : "assistant-msg--ai"}`}
                        >
                          <div
                            className={`assistant-msg__avatar ${msg.role === "user" ? "assistant-msg__avatar--user" : "assistant-msg__avatar--ai"}`}
                          >
                            {msg.role === "user" ? (
                              <User size={14} />
                            ) : (
                              <Bot size={14} />
                            )}
                          </div>
                          <div className="assistant-msg__bubble">
                            {msg.role === "ai" ? (
                              <div className="md-content">
                                <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{msg.text}</Markdown>
                              </div>
                            ) : (
                              msg.text
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="assistant-input-row">
                    <textarea
                      className="alice-textarea"
                      value={assistQ}
                      onChange={(e) => setAssistQ(e.target.value)}
                      placeholder="Posez une question sur ce chapitre..."
                      rows={2}
                      style={{ minHeight: "60px" }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          runAssist();
                        }
                      }}
                    />
                    <Button
                      variant="primary"
                      size="md"
                      icon={<Send size={14} />}
                      disabled={loading || !assistQ.trim()}
                      loading={loading}
                      onClick={runAssist}
                    >
                      Envoyer
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
