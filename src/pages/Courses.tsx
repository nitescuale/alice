import { useCallback, useEffect, useState } from "react";
import Markdown from "react-markdown";
import { api } from "../api";

type Chapter = { id: string; title: string; path?: string };
type Course = { id: string; title: string; chapters: Chapter[] };
type Subject = { id: string; title: string; courses: Course[] };

export function Courses() {
  const [tax, setTax] = useState<{ subjects: Subject[] } | null>(null);
  const [sel, setSel] = useState<{
    subjectId: string;
    courseId: string;
    chapterId: string;
  } | null>(null);
  const [content, setContent] = useState<{ markdown: string; files: { path: string }[] } | null>(null);
  const [assistQ, setAssistQ] = useState("");
  const [assistA, setAssistA] = useState("");
  const [loading, setLoading] = useState(false);
  const [indexMsg, setIndexMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    api<{ subjects: Subject[] }>("/api/taxonomy")
      .then(setTax)
      .catch((e: Error) => setErr(String(e.message)));
  }, []);

  const loadChapter = useCallback(
    async (subjectId: string, courseId: string, chapterId: string) => {
      setSel({ subjectId, courseId, chapterId });
      setErr("");
      setLoading(true);
      try {
        const c = await api<{ markdown: string; files: { path: string }[] }>(
          "/api/chapter/content",
          {
            method: "POST",
            body: JSON.stringify({ subject_id: subjectId, course_id: courseId, chapter_id: chapterId }),
          },
        );
        setContent(c);
        await api("/api/progress/chapter/" + encodeURIComponent(chapterId), { method: "POST" });
      } catch (e) {
        setErr(String(e));
        setContent(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  async function runAssist() {
    if (!sel || !assistQ.trim()) return;
    setErr("");
    setLoading(true);
    try {
      const r = await api<{ answer: string }>("/api/assist", {
        method: "POST",
        body: JSON.stringify({
          question: assistQ,
          subject_id: sel.subjectId,
          course_id: sel.courseId,
          chapter_id: sel.chapterId,
        }),
      });
      setAssistA(r.answer);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
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
      setIndexMsg(JSON.stringify(r, null, 2));
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <div>
      <h1>Cours</h1>
      <p className="muted">
        Navigation par matière → cours → chapitre. Le RAG alimente l’assistant (pas de repérage « où c’est dit » dans l’UI).
      </p>
      {err && <p className="error">{err}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem", marginTop: "1rem" }}>
        <div>
          <h2>Arborescence</h2>
          {!tax && <p className="muted">Chargement…</p>}
          <ul className="tree">
            {tax?.subjects.map((s) => (
              <li key={s.id}>
                <strong>{s.title}</strong>
                <ul className="tree">
                  {s.courses.map((c) => (
                    <li key={c.id}>
                      {c.title}
                      <ul className="tree">
                        {c.chapters.map((ch) => (
                          <li key={ch.id}>
                            <button
                              type="button"
                              className={
                                "link" +
                                (sel?.chapterId === ch.id ? " active" : "")
                              }
                              onClick={() => loadChapter(s.id, c.id, ch.id)}
                            >
                              {ch.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <p style={{ marginTop: "1rem" }}>
            <button type="button" className="secondary" onClick={rebuildIndex}>
              Réindexer RAG
            </button>
          </p>
          {indexMsg && (
            <pre style={{ fontSize: "0.75rem", marginTop: "0.5rem", whiteSpace: "pre-wrap" }}>
              {indexMsg}
            </pre>
          )}
        </div>

        <div>
          <h2>Contenu</h2>
          {loading && <p className="muted">Chargement…</p>}
          {content && (
            <>
              <p className="muted">
                Fichiers : {content.files.map((f) => f.path).join(", ") || "—"}
              </p>
              <div className="md">
                <Markdown>{content.markdown}</Markdown>
              </div>
            </>
          )}

          {sel && (
            <>
              <h2>Assistant (RAG + Ollama)</h2>
              <textarea
                value={assistQ}
                onChange={(e) => setAssistQ(e.target.value)}
                placeholder="Pose une question sur ce chapitre…"
              />
              <p style={{ marginTop: "0.5rem" }}>
                <button type="button" disabled={loading} onClick={runAssist}>
                  Demander
                </button>
              </p>
              {assistA && (
                <div className="md" style={{ marginTop: "1rem" }}>
                  <Markdown>{assistA}</Markdown>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
