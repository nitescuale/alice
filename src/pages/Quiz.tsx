import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Brain,
  AlertCircle,
  Clock,
  Trophy,
  CheckCircle2,
  XCircle,
  Loader2,
  Square,
  Database,
  RefreshCw,
  Sparkles,
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
import { Input } from "../components/Input";
import { ProgressRing } from "../components/ProgressRing";

type Chapter = { id: string; title: string };
type Subject = { id: string; title: string; chapters: Chapter[] };

type QItem = { q: string; options: string[]; correct: number };

type BankStatus = {
  subject_id: string;
  chapter_id: string;
  count: number;
  has_bank: boolean;
};

type BanksSummary = {
  subject_id: string;
  chapters: { chapter_id: string; count: number }[];
  total: number;
};

/* ---- Module-level state: survives component unmount/remount ---- */
/** _genPromise now tracks the SLOW bank-generation call (not the fast quiz sampling). */
let _genPromise: Promise<unknown> | null = null;
let _genLoadingMsg = "";
let _genAbort: AbortController | null = null;
let _stash: {
  questions: QItem[];
  answers: Record<string, number>;
  result: { correct: number; total: number; score: number } | null;
  filters: { subjectId: string; chapterId: string; numQuestions: string };
} | null = null;

const LETTERS = ["A", "B", "C", "D", "E", "F"];

export function Quiz() {
  const [tax, setTax] = useState<{ subjects: Subject[] } | null>(null);
  const [subjectId, setSubjectId] = useState(() => _stash?.filters.subjectId ?? "");
  const [chapterId, setChapterId] = useState(() => _stash?.filters.chapterId ?? "");
  const [numQuestions, setNumQuestions] = useState(() => _stash?.filters.numQuestions ?? "10");
  const [questions, setQuestions] = useState<QItem[]>(() => _stash?.questions ?? []);
  const [answers, setAnswers] = useState<Record<string, number>>(() => _stash?.answers ?? {});
  const [result, setResult] = useState<{
    correct: number;
    total: number;
    score: number;
  } | null>(() => _stash?.result ?? null);
  const [history, setHistory] = useState<Record<string, unknown>[]>([]);

  /* Quiz sampling (fast) */
  const [quizLoading, setQuizLoading] = useState(false);
  const [err, setErr] = useState("");

  /* Bank status */
  const [bankStatus, setBankStatus] = useState<BankStatus | null>(null);
  const [banksSummary, setBanksSummary] = useState<BanksSummary | null>(null);
  const [bankStatusLoading, setBankStatusLoading] = useState(false);

  /* Bank generation (slow) */
  const [bankGenLoading, setBankGenLoading] = useState(false);
  const [bankGenMsg, setBankGenMsg] = useState("");

  /* Pick up a pending BANK generation that started before navigation */
  useEffect(() => {
    if (_genPromise) {
      setBankGenLoading(true);
      setBankGenMsg(_genLoadingMsg);
      _genPromise
        .catch((e) => {
          if (_genAbort?.signal.aborted) return;
          setErr(String(e));
        })
        .finally(() => {
          _genPromise = null;
          _genAbort = null;
          setBankGenLoading(false);
          setBankGenMsg("");
        });
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
    const raw = tax?.subjects.find((s) => s.id === subjectId)?.chapters ?? [];
    return [{ id: "", title: "Tous les chapitres" }, ...raw];
  }, [tax, subjectId]);

  const isAllChapters = chapterId === "";

  /* Load bank status when subject/chapter changes */
  const loadBankStatus = useCallback(async () => {
    if (!subjectId) {
      setBankStatus(null);
      setBanksSummary(null);
      return;
    }
    setBankStatusLoading(true);
    try {
      if (isAllChapters) {
        const s = await api<BanksSummary>(
          `/api/questions/banks?subject_id=${encodeURIComponent(subjectId)}`,
        );
        setBanksSummary(s);
        setBankStatus(null);
      } else {
        const b = await api<BankStatus>(
          `/api/questions/bank?subject_id=${encodeURIComponent(subjectId)}&chapter_id=${encodeURIComponent(chapterId)}`,
        );
        setBankStatus(b);
        setBanksSummary(null);
      }
    } catch (e) {
      setErr(String(e));
      setBankStatus(null);
      setBanksSummary(null);
    } finally {
      setBankStatusLoading(false);
    }
  }, [subjectId, chapterId, isAllChapters]);

  useEffect(() => {
    loadBankStatus();
  }, [loadBankStatus]);

  /* Available question count for current selection */
  const availableCount = useMemo(() => {
    if (isAllChapters) return banksSummary?.total ?? 0;
    return bankStatus?.count ?? 0;
  }, [isAllChapters, banksSummary, bankStatus]);

  /* Keep numQuestions within [1, availableCount] and default to min(10, count) on selection change */
  useEffect(() => {
    if (availableCount <= 0) return;
    const current = parseInt(numQuestions, 10);
    if (!current || current < 1) {
      setNumQuestions(String(Math.min(10, availableCount)));
    } else if (current > availableCount) {
      setNumQuestions(String(availableCount));
    }
  }, [availableCount]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Bank generation (SLOW) ---------- */
  async function generateBank(force = false) {
    if (!subjectId) return;
    if (force) {
      const ok = window.confirm(
        "Regenerer la banque ? Les questions existantes seront remplacees.",
      );
      if (!ok) return;
    }
    setErr("");

    const abort = new AbortController();
    _genAbort = abort;
    setBankGenLoading(true);

    try {
      if (isAllChapters) {
        const subj = tax?.subjects.find((s) => s.id === subjectId);
        const chs = subj?.chapters ?? [];
        const total = chs.length;
        for (let i = 0; i < chs.length; i++) {
          if (abort.signal.aborted) return;
          const ch = chs[i];
          const msg = `Chapitre ${i + 1}/${total} - Generation exhaustive de la banque (1-3 min)...`;
          setBankGenMsg(msg);
          _genLoadingMsg = msg;
          const p = api<{ count: number }>("/api/questions/generate", {
            method: "POST",
            body: JSON.stringify({
              subject_id: subjectId,
              chapter_id: ch.id,
              force,
            }),
            signal: abort.signal,
          });
          _genPromise = p;
          await p;
        }
      } else {
        const msg = "Generation exhaustive de la banque de questions (1-3 min)...";
        setBankGenMsg(msg);
        _genLoadingMsg = msg;
        const p = api<{ count: number }>("/api/questions/generate", {
          method: "POST",
          body: JSON.stringify({
            subject_id: subjectId,
            chapter_id: chapterId,
            force,
          }),
          signal: abort.signal,
        });
        _genPromise = p;
        await p;
      }
      await loadBankStatus();
    } catch (e) {
      if (abort.signal.aborted) return;
      setErr(String(e));
    } finally {
      _genPromise = null;
      _genAbort = null;
      setBankGenLoading(false);
      setBankGenMsg("");
    }
  }

  function cancelBankGeneration() {
    if (_genAbort) {
      _genAbort.abort();
      _genAbort = null;
    }
    _genPromise = null;
    setBankGenLoading(false);
    setBankGenMsg("");
  }

  /* ---------- Quiz sampling (FAST) ---------- */
  async function generate() {
    if (!subjectId) return;
    if (availableCount <= 0) return;
    setErr("");
    setQuizLoading(true);
    setResult(null);
    setAnswers({});
    setQuestions([]);

    const n = Math.max(
      1,
      Math.min(availableCount, parseInt(numQuestions, 10) || 10),
    );

    const filters = { subjectId, chapterId, numQuestions: String(n) };

    try {
      const data = await api<{ questions?: QItem[]; raw?: string }>(
        "/api/quiz/generate",
        {
          method: "POST",
          body: JSON.stringify({
            chapter_id: chapterId,
            subject_id: subjectId,
            num_questions: n,
          }),
        },
      );
      const qs = data.questions ?? [];
      setQuestions(qs);
      _stash = { questions: qs, answers: {}, result: null, filters };
      if (!qs.length && data.raw) {
        setErr("Reponse LLM non JSON : verifiez Ollama / le modele.");
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setQuizLoading(false);
    }
  }

  async function grade() {
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

  const answeredCount = Object.keys(answers).length;
  const progress =
    questions.length > 0 ? (answeredCount / questions.length) * 100 : 0;

  const parsedNum = parseInt(numQuestions, 10);
  const numValid = !!parsedNum && parsedNum >= 1 && parsedNum <= availableCount;
  const canQuiz = !!subjectId && availableCount > 0 && numValid && !quizLoading && !bankGenLoading;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Quiz</h1>
        <p className="page-header__subtitle">
          Banque de questions pre-generee via RAG + Ollama. Generez la banque
          une fois, puis echantillonnez instantanement.
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
          value={chapterId}
          onChange={(e) => setChapterId(e.target.value)}
        />
        <Input
          label={`Nombre de questions${availableCount > 0 ? ` (max ${availableCount})` : ""}`}
          type="number"
          min={1}
          max={availableCount > 0 ? availableCount : undefined}
          value={numQuestions}
          disabled={availableCount <= 0}
          onChange={(e) => setNumQuestions(e.target.value)}
        />
        <div style={{ alignSelf: "flex-end" }}>
          <Button
            variant="primary"
            icon={quizLoading ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
            disabled={!canQuiz}
            loading={quizLoading}
            onClick={generate}
          >
            {quizLoading ? "Generation..." : "Generer QCM"}
          </Button>
        </div>
      </div>

      {/* Bank status panel */}
      {subjectId && !bankGenLoading && (
        <Card
          variant="default"
          padding="md"
          className="animate-fade-in"
          style={{ marginBottom: "var(--sp-4)" }}
        >
          {bankStatusLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", color: "var(--noir-400)" }}>
              <Loader2 size={14} className="spin" />
              <span>Chargement de la banque...</span>
            </div>
          ) : isAllChapters ? (
            banksSummary && banksSummary.total > 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
                <Database size={16} style={{ color: "var(--amber-400)", flexShrink: 0 }} />
                <span style={{ fontSize: "0.9rem" }}>
                  Banque : <strong>{banksSummary.total}</strong> questions disponibles sur {banksSummary.chapters.length} chapitre{banksSummary.chapters.length > 1 ? "s" : ""}
                </span>
                <div style={{ marginLeft: "auto" }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<RefreshCw size={12} />}
                    onClick={() => generateBank(true)}
                  >
                    Regenerer tout
                  </Button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                  <Database size={16} style={{ color: "var(--noir-400)", flexShrink: 0 }} />
                  <span>Aucune banque de questions pour cette matiere.</span>
                </div>
                <div>
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Sparkles size={14} />}
                    onClick={() => generateBank(false)}
                  >
                    Generer la banque pour tous les chapitres
                  </Button>
                </div>
              </div>
            )
          ) : bankStatus && bankStatus.count > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
              <Database size={16} style={{ color: "var(--amber-400)", flexShrink: 0 }} />
              <span style={{ fontSize: "0.9rem" }}>
                Banque : <strong>{bankStatus.count}</strong> questions disponibles
              </span>
              <div style={{ marginLeft: "auto" }}>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RefreshCw size={12} />}
                  onClick={() => generateBank(true)}
                >
                  Regenerer
                </Button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                <Database size={16} style={{ color: "var(--noir-400)", flexShrink: 0 }} />
                <span>Aucune banque de questions pour ce chapitre.</span>
              </div>
              <div>
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Sparkles size={14} />}
                  onClick={() => generateBank(false)}
                >
                  Generer la banque
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Bank generation loading indicator */}
      {bankGenLoading && (
        <div className="quiz-loading animate-fade-in">
          <Loader2 size={20} className="spin" style={{ color: "var(--amber-400)" }} />
          <span className="quiz-loading__msg">{bankGenMsg}</span>
          <span className="quiz-loading__hint">
            Le modele LLM analyse le chapitre et construit la banque — cela peut prendre plusieurs minutes.
          </span>
          <Button variant="ghost" size="sm" icon={<Square size={12} />} onClick={cancelBankGeneration}>
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
              <Button variant="primary" size="sm" onClick={generate} disabled={!canQuiz}>
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
