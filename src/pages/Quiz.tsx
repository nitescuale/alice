import { useEffect, useMemo, useState } from "react";
import {
  Brain,
  AlertCircle,
  Clock,
  Trophy,
  Sparkles,
  CheckCircle2,
  XCircle,
  Loader2,
  Square,
} from "lucide-react";
import Markdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { api } from "../api";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Select } from "../components/Select";
import { Badge } from "../components/Badge";
import { ProgressRing } from "../components/ProgressRing";

type Chapter = { id: string; title: string };
type Subject = { id: string; title: string; chapters: Chapter[] };

type QItem = { q: string; options: string[]; correct: number };

/* ---- Module-level state: survives component unmount/remount ---- */
let _genPromise: Promise<{ questions?: QItem[]; raw?: string }> | null = null;
let _genLoadingMsg = "";
let _genAbort: AbortController | null = null;
let _stash: {
  questions: QItem[];
  answers: Record<string, number>;
  result: { correct: number; total: number; score: number } | null;
  filters: { subjectId: string; chapterId: string; numQuestions: string };
} | null = null;

const LETTERS = ["A", "B", "C", "D", "E", "F"];

const NUM_QUESTION_OPTIONS = [
  { value: "5", label: "5 questions" },
  { value: "10", label: "10 questions" },
  { value: "20", label: "20 questions" },
  { value: "30", label: "30 questions" },
];

export function Quiz() {
  const [tax, setTax] = useState<{ subjects: Subject[] } | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [numQuestions, setNumQuestions] = useState("10");
  const [questions, setQuestions] = useState<QItem[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<{
    correct: number;
    total: number;
    score: number;
  } | null>(null);
  const [history, setHistory] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [err, setErr] = useState("");

  /* Restore state from module-level stash or pick up pending generation */
  useEffect(() => {
    if (_genPromise) {
      setLoading(true);
      setLoadingMsg(_genLoadingMsg);
      _genPromise
        .then((data) => {
          const qs = data.questions ?? [];
          setQuestions(qs);
          if (_stash) {
            _stash.questions = qs;
            _stash.answers = {};
            _stash.result = null;
          }
          if (!qs.length && data.raw) {
            setErr("Reponse LLM non JSON : verifiez Ollama / le modele.");
          }
        })
        .catch((e) => setErr(String(e)))
        .finally(() => {
          _genPromise = null;
          setLoading(false);
          setLoadingMsg("");
        });
    } else if (_stash) {
      setQuestions(_stash.questions);
      setAnswers(_stash.answers);
      setResult(_stash.result);
    }
  }, []);

  /* Sync answers & result back to module-level stash */
  useEffect(() => {
    if (_stash) _stash.answers = answers;
  }, [answers]);

  useEffect(() => {
    if (_stash) _stash.result = result;
  }, [result]);

  useEffect(() => {
    api<{ subjects: Subject[] }>("/api/taxonomy")
      .then((t) => {
        setTax(t);
        if (_stash?.filters) {
          setSubjectId(_stash.filters.subjectId);
          setChapterId(_stash.filters.chapterId);
          setNumQuestions(_stash.filters.numQuestions);
        } else {
          const s0 = t.subjects[0];
          if (s0) {
            setSubjectId(s0.id);
            const ch0 = s0.chapters[0];
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

  const chapters = useMemo(() => {
    return tax?.subjects.find((s) => s.id === subjectId)?.chapters ?? [];
  }, [tax, subjectId]);

  const answeredCount = Object.keys(answers).length;
  const progress =
    questions.length > 0 ? (answeredCount / questions.length) * 100 : 0;

  async function generate() {
    if (!chapterId || !subjectId) return;
    setErr("");
    setLoading(true);
    setResult(null);
    setAnswers({});
    setQuestions([]);

    const n = parseInt(numQuestions, 10) || 10;
    const batchCount = Math.ceil(n / 10);
    if (batchCount > 1) {
      setLoadingMsg(`Generation du quiz (${n} questions en ${batchCount} batches)...`);
    } else {
      setLoadingMsg("Generation du quiz...");
    }

    const abort = new AbortController();
    _genAbort = abort;

    const promise = api<{ questions?: QItem[]; raw?: string }>(
      "/api/quiz/generate",
      {
        method: "POST",
        body: JSON.stringify({
          chapter_id: chapterId,
          subject_id: subjectId,
          num_questions: n,
        }),
        signal: abort.signal,
      }
    );
    _genPromise = promise;
    _genLoadingMsg = batchCount > 1
      ? `Generation du quiz (${n} questions en ${batchCount} batches)...`
      : "Generation du quiz...";

    const filters = { subjectId, chapterId, numQuestions };

    try {
      const data = await promise;
      const qs = data.questions ?? [];
      setQuestions(qs);
      _stash = { questions: qs, answers: {}, result: null, filters };
      if (!qs.length && data.raw) {
        setErr("Reponse LLM non JSON : verifiez Ollama / le modele.");
      }
    } catch (e) {
      if (abort.signal.aborted) return;
      setErr(String(e));
    } finally {
      _genPromise = null;
      _genAbort = null;
      setLoading(false);
      setLoadingMsg("");
    }
  }

  function cancelGeneration() {
    if (_genAbort) {
      _genAbort.abort();
      _genAbort = null;
    }
    _genPromise = null;
    setLoading(false);
    setLoadingMsg("");
  }

  async function grade() {
    if (!chapterId) return;
    setErr("");
    try {
      const r = await api<{
        correct: number;
        total: number;
        score: number;
      }>("/api/quiz/grade", {
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

  function getOptionClass(qIdx: number, optIdx: number) {
    const base = "quiz-option";
    if (!result) {
      return answers[String(qIdx)] === optIdx
        ? `${base} quiz-option--selected`
        : base;
    }
    const q = questions[qIdx];
    if (optIdx === q.correct) return `${base} quiz-option--correct`;
    if (answers[String(qIdx)] === optIdx && optIdx !== q.correct)
      return `${base} quiz-option--wrong`;
    return base;
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Quiz</h1>
        <p className="page-header__subtitle">
          Generation de QCM via RAG + Ollama. Choisissez un chapitre et testez
          vos connaissances.
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

      {/* Selectors */}
      <div className="quiz-selectors">
        <Select
          label="Matiere"
          options={
            tax?.subjects.map((s) => ({ value: s.id, label: s.title })) ?? []
          }
          placeholder="Matiere"
          value={subjectId}
          onChange={(e) => {
            setSubjectId(e.target.value);
            setChapterId("");
          }}
        />
        <Select
          label="Chapitre"
          options={chapters.map((ch) => ({ value: ch.id, label: ch.title }))}
          placeholder="Chapitre"
          value={chapterId}
          onChange={(e) => setChapterId(e.target.value)}
        />
        <Select
          label="Nombre de questions"
          options={NUM_QUESTION_OPTIONS}
          value={numQuestions}
          onChange={(e) => setNumQuestions(e.target.value)}
        />
        <div style={{ alignSelf: "flex-end" }}>
          <Button
            variant="primary"
            icon={loading ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
            disabled={loading || !chapterId}
            loading={loading}
            onClick={generate}
          >
            {loading ? "Generation..." : "Generer QCM"}
          </Button>
        </div>
      </div>

      {/* Loading indicator */}
      {loading && (
        <div className="quiz-loading animate-fade-in">
          <Loader2 size={20} className="spin" style={{ color: "var(--amber-400)" }} />
          <span className="quiz-loading__msg">{loadingMsg}</span>
          <span className="quiz-loading__hint">
            Le modele LLM genere les questions — cela peut prendre quelques instants.
          </span>
          <Button variant="ghost" size="sm" icon={<Square size={12} />} onClick={cancelGeneration}>
            Annuler
          </Button>
        </div>
      )}

      {/* Progress bar */}
      {questions.length > 0 && !result && (
        <div className="quiz-progress animate-fade-in">
          <Brain size={16} style={{ color: "var(--amber-400)", flexShrink: 0 }} />
          <div className="quiz-progress__bar">
            <div
              className="quiz-progress__fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="quiz-progress__text">
            {answeredCount} / {questions.length}
          </span>
        </div>
      )}

      {/* Score result */}
      {result && (
        <Card variant="amber" padding="none" className="quiz-score" style={{ marginBottom: "var(--sp-6)" }}>
          <div className="quiz-score__ring">
            <ProgressRing
              value={result.score * 100}
              size={110}
              strokeWidth={10}
              label={`${Math.round(result.score * 100)}%`}
            />
          </div>
          <div className="quiz-score__details">
            <h3>
              {result.score >= 0.8
                ? "Excellent !"
                : result.score >= 0.5
                  ? "Pas mal !"
                  : "A retravailler"}
            </h3>
            <p>
              {result.correct} bonne{result.correct > 1 ? "s" : ""} reponse
              {result.correct > 1 ? "s" : ""} sur {result.total}
            </p>
            <div style={{ display: "flex", gap: "var(--sp-2)", marginTop: "var(--sp-3)" }}>
              <Button variant="primary" size="sm" onClick={generate}>
                Nouveau quiz
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Questions */}
      {questions.map((q, i) => (
        <Card
          key={i}
          variant="default"
          padding="md"
          className="quiz-question"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <div className="quiz-question__number">
            Question {i + 1} sur {questions.length}
          </div>
          <div className="quiz-question__text md-content md-content--inline">
            <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{q.q}</Markdown>
          </div>
          {q.options?.map((opt, j) => (
            <div
              key={j}
              className={getOptionClass(i, j)}
              onClick={() => {
                if (result) return;
                setAnswers((a) => ({ ...a, [String(i)]: j }));
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (result) return;
                if (e.key === "Enter" || e.key === " ") {
                  setAnswers((a) => ({ ...a, [String(i)]: j }));
                }
              }}
            >
              {!result && <span className="quiz-option__radio" />}
              {result && (
                <span style={{ display: "flex", flexShrink: 0 }}>
                  {j === q.correct ? (
                    <CheckCircle2 size={18} style={{ color: "var(--success-500)" }} />
                  ) : answers[String(i)] === j ? (
                    <XCircle size={18} style={{ color: "var(--danger-500)" }} />
                  ) : (
                    <span className="quiz-option__radio" />
                  )}
                </span>
              )}
              <span className="quiz-option__letter">{LETTERS[j]}</span>
              <span className="md-content md-content--inline">
                <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{opt}</Markdown>
              </span>
            </div>
          ))}
        </Card>
      ))}

      {/* Grade button */}
      {questions.length > 0 && !result && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: "var(--sp-4)", marginBottom: "var(--sp-8)" }}>
          <Button
            variant="primary"
            size="lg"
            icon={<Trophy size={16} />}
            disabled={answeredCount < questions.length}
            onClick={grade}
          >
            Valider mes reponses
          </Button>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="quiz-history">
          <h2 style={{ marginBottom: "var(--sp-4)" }}>Historique</h2>
          <Card variant="default" padding="sm">
            {history.slice(0, 15).map((h, i) => (
              <div key={i} className="quiz-history__item">
                <Clock size={14} style={{ color: "var(--noir-400)", flexShrink: 0 }} />
                <span className="quiz-history__chapter">
                  {String(h.chapter_id)}
                </span>
                <Badge
                  variant={
                    Number(h.score) / Number(h.total) >= 0.8
                      ? "success"
                      : Number(h.score) / Number(h.total) >= 0.5
                        ? "amber"
                        : "danger"
                  }
                  size="sm"
                >
                  {String(h.score)}/{String(h.total)}
                </Badge>
                <span className="quiz-history__date">
                  {String(h.created_at).slice(0, 16).replace("T", " ")}
                </span>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
