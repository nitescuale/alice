import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

type Chapter = { id: string; title: string };
type Course = { id: string; title: string; chapters: Chapter[] };
type Subject = { id: string; title: string; courses: Course[] };

type QItem = { q: string; options: string[]; correct: number };

export function Quiz() {
  const [tax, setTax] = useState<{ subjects: Subject[] } | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [questions, setQuestions] = useState<QItem[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<{ correct: number; total: number; score: number } | null>(null);
  const [history, setHistory] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api<{ subjects: Subject[] }>("/api/taxonomy")
      .then((t) => {
        setTax(t);
        const s0 = t.subjects[0];
        if (s0) {
          setSubjectId(s0.id);
          const c0 = s0.courses[0];
          if (c0) {
            setCourseId(c0.id);
            const ch0 = c0.chapters[0];
            if (ch0) setChapterId(ch0.id);
          }
        }
      })
      .catch((e: Error) => setErr(String(e.message)));
  }, []);

  useEffect(() => {
    api<Record<string, unknown>[]>("/api/progress/quiz")
      .then(setHistory)
      .catch(() => {});
  }, [result]);

  const courses = useMemo(() => {
    return tax?.subjects.find((s) => s.id === subjectId)?.courses ?? [];
  }, [tax, subjectId]);

  const chapters = useMemo(() => {
    return courses.find((c) => c.id === courseId)?.chapters ?? [];
  }, [courses, courseId]);

  async function generate() {
    if (!chapterId || !courseId || !subjectId) return;
    setErr("");
    setLoading(true);
    setResult(null);
    setAnswers({});
    try {
      const data = await api<{ questions?: QItem[]; raw?: string }>("/api/quiz/generate", {
        method: "POST",
        body: JSON.stringify({
          chapter_id: chapterId,
          course_id: courseId,
          subject_id: subjectId,
          num_questions: 5,
        }),
      });
      setQuestions(data.questions ?? []);
      if (!data.questions?.length && data.raw) {
        setErr("Réponse LLM non JSON : vérifie Ollama / le modèle.");
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function grade() {
    if (!chapterId) return;
    setErr("");
    try {
      const r = await api<{ correct: number; total: number; score: number }>("/api/quiz/grade", {
        method: "POST",
        body: JSON.stringify({
          chapter_id: chapterId,
          answers,
          questions,
        }),
      });
      setResult(r);
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <div>
      <h1>Quiz / QCM</h1>
      <p className="muted">Génération via RAG + Ollama (contexte chapitre).</p>
      {err && <p className="error">{err}</p>}

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}>
        <select value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setCourseId(""); setChapterId(""); }}>
          <option value="">Matière</option>
          {tax?.subjects.map((s) => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </select>
        <select value={courseId} onChange={(e) => { setCourseId(e.target.value); setChapterId(""); }}>
          <option value="">Cours</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>
        <select value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
          <option value="">Chapitre</option>
          {chapters.map((ch) => (
            <option key={ch.id} value={ch.id}>{ch.title}</option>
          ))}
        </select>
        <button type="button" disabled={loading || !chapterId} onClick={generate}>
          Générer QCM
        </button>
      </div>

      {questions.map((q, i) => (
        <fieldset key={i} style={{ border: "1px solid #2f3336", borderRadius: 8, padding: "0.75rem", marginBottom: "0.75rem" }}>
          <legend style={{ padding: "0 0.35rem" }}>{i + 1}. {q.q}</legend>
          {q.options?.map((opt, j) => (
            <label key={j} style={{ display: "block", margin: "0.25rem 0" }}>
              <input
                type="radio"
                name={`q-${i}`}
                checked={answers[String(i)] === j}
                onChange={() => setAnswers((a) => ({ ...a, [String(i)]: j }))}
              />{" "}
              {opt}
            </label>
          ))}
        </fieldset>
      ))}

      {questions.length > 0 && (
        <button type="button" onClick={grade}>Valider</button>
      )}

      {result && (
        <p style={{ marginTop: "1rem" }}>
          Score : {result.correct} / {result.total} ({(result.score * 100).toFixed(0)} %)
        </p>
      )}

      <h2 style={{ marginTop: "2rem" }}>Historique récent</h2>
      <ul className="muted" style={{ fontSize: "0.85rem" }}>
        {history.slice(0, 15).map((h, i) => (
          <li key={i}>
            {String(h.chapter_id)} — {String(h.score)}/{String(h.total)} — {String(h.created_at)}
          </li>
        ))}
      </ul>
    </div>
  );
}
