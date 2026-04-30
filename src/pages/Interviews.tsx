import { useCallback, useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  Shuffle,
  Lightbulb,
  Send,
  Eye,
  EyeOff,
  Loader2,
  Download,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Sparkles,
  BookOpen,
  ArrowUp,
  Languages,
} from "lucide-react";
import { api } from "../api";
import { Card, CardHeader } from "../components/Card";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { Select } from "../components/Select";

interface Topic {
  slug: string;
  label: string;
  count: number;
}

interface TranslationProgress {
  running: boolean;
  done: number;
  total: number;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}

interface BankStatus {
  count: number;
  topics: Topic[];
  translation?: TranslationProgress;
}

interface BankQuestion {
  id: number;
  topic: string;
  topic_label: string;
  source_path: string;
  idx: number;
  question: string;
  question_en: string;
  reference_answer: string;
  reference_answer_en: string;
}

interface Evaluation {
  score: number | null;
  verdict: string;
  points_corrects: string[];
  points_manquants: string[];
  erreurs: string[];
  enrichissement: string;
}

const md = (src: string) => (
  <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
    {src}
  </Markdown>
);

const mdInline = (src: string) => (
  <Markdown
    remarkPlugins={[remarkMath]}
    rehypePlugins={[rehypeKatex]}
    components={{ p: ({ children }) => <>{children}</> }}
  >
    {src}
  </Markdown>
);

export function Interviews() {
  const [bankStatus, setBankStatus] = useState<BankStatus | null>(null);
  const [topic, setTopic] = useState<string>("");
  const [question, setQuestion] = useState<BankQuestion | null>(null);
  const [answer, setAnswer] = useState("");
  const [hint, setHint] = useState<string>("");
  const [showReference, setShowReference] = useState(false);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [lang, setLang] = useState<"fr" | "en">("fr");

  const [loadingBank, setLoadingBank] = useState(false);
  const [loadingQ, setLoadingQ] = useState(false);
  const [loadingHint, setLoadingHint] = useState(false);
  const [loadingGrade, setLoadingGrade] = useState(false);
  const [importing, setImporting] = useState(false);
  const [err, setErr] = useState<string>("");

  const fetchStatus = useCallback(async () => {
    setLoadingBank(true);
    try {
      const s = await api<BankStatus>("/api/interview/bank/status");
      setBankStatus(s);
      if (!topic && s.topics.length) setTopic(s.topics[0].slug);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Erreur chargement banque");
    } finally {
      setLoadingBank(false);
    }
  }, [topic]);

  useEffect(() => {
    fetchStatus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!bankStatus?.translation?.running) return;
    const id = setInterval(() => {
      api<BankStatus>("/api/interview/bank/status")
        .then(setBankStatus)
        .catch(() => {});
    }, 2000);
    return () => clearInterval(id);
  }, [bankStatus?.translation?.running]);

  const resetQuestionState = () => {
    setAnswer("");
    setHint("");
    setShowReference(false);
    setEvaluation(null);
    setErr("");
    setLang("fr");
  };

  const displayQ =
    lang === "en" && question?.question_en
      ? question.question_en
      : question?.question ?? "";
  const displayRef =
    lang === "en" && question?.reference_answer_en
      ? question.reference_answer_en
      : question?.reference_answer ?? "";
  const enAvailable = !!(question?.question_en && question?.reference_answer_en);

  const importBank = async () => {
    setImporting(true);
    setErr("");
    try {
      await api("/api/interview/bank/import", { method: "POST" });
      await fetchStatus();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Échec de l'import");
    } finally {
      setImporting(false);
    }
  };

  const pickRandom = async () => {
    setLoadingQ(true);
    resetQuestionState();
    try {
      const q = topic
        ? await api<BankQuestion>(
            `/api/interview/question/random?topic=${encodeURIComponent(topic)}`,
          )
        : await api<BankQuestion>("/api/interview/question/random");
      setQuestion(q);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Impossible de tirer une question");
    } finally {
      setLoadingQ(false);
    }
  };

  const requestHint = async () => {
    if (!question) return;
    setLoadingHint(true);
    setErr("");
    try {
      const r = await api<{ hint: string }>("/api/interview/open/hint", {
        method: "POST",
        body: JSON.stringify({
          question: displayQ,
          reference_answer: displayRef,
          user_answer: answer,
        }),
      });
      setHint(r.hint);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Erreur lors de la demande d'indice");
    } finally {
      setLoadingHint(false);
    }
  };

  const submitAnswer = async () => {
    if (!question || !answer.trim()) return;
    setLoadingGrade(true);
    setErr("");
    try {
      const r = await api<{ evaluation: Evaluation; attempt_id: number | null }>(
        "/api/interview/open/grade",
        {
          method: "POST",
          body: JSON.stringify({
            question: displayQ,
            reference_answer: displayRef,
            user_answer: answer,
            bank_id: question.id,
            topic: question.topic,
          }),
        },
      );
      setEvaluation(r.evaluation);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Erreur lors de l'évaluation");
    } finally {
      setLoadingGrade(false);
    }
  };

  const topicOptions = useMemo(
    () =>
      (bankStatus?.topics ?? []).map((t) => ({
        value: t.slug,
        label: `${t.label} (${t.count})`,
      })),
    [bankStatus],
  );

  const bankEmpty = !loadingBank && (bankStatus?.count ?? 0) === 0;

  return (
    <div style={{ padding: "var(--sp-6)", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ marginBottom: "var(--sp-5)" }}>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-2xl)",
            fontWeight: 700,
            margin: 0,
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-2)",
          }}
        >
          <Sparkles size={22} style={{ color: "var(--amber-400)" }} />
          Entraînement entretiens
        </h1>
        <p style={{ color: "var(--noir-400)", margin: "var(--sp-2) 0 0" }}>
          Banque de questions curées (
          <a
            href="https://github.com/youssefHosni/Data-Science-Interview-Questions-Answers"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--amber-400)" }}
          >
            youssefHosni/Data-Science-Interview-Questions-Answers
          </a>
          ). Tu réponds librement, Ollama évalue ta réponse contre la référence et te donne des
          indices sur demande.
        </p>
      </div>

      {err && (
        <Card variant="default" padding="md" style={{ marginBottom: "var(--sp-4)" }}>
          <div style={{ display: "flex", gap: "var(--sp-2)", color: "var(--danger-400)" }}>
            <AlertCircle size={16} />
            <span style={{ fontSize: "var(--text-sm)" }}>{err}</span>
          </div>
        </Card>
      )}

      {bankEmpty && (
        <Card variant="amber" padding="lg" style={{ marginBottom: "var(--sp-5)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
            <BookOpen size={28} style={{ color: "var(--amber-400)" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>Banque vide</div>
              <div style={{ fontSize: "var(--text-sm)", color: "var(--noir-300)" }}>
                Importe les questions depuis le repo GitHub pour commencer.
              </div>
            </div>
            <Button
              variant="primary"
              icon={importing ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
              onClick={importBank}
              disabled={importing}
            >
              {importing ? "Import en cours…" : "Importer la banque"}
            </Button>
          </div>
        </Card>
      )}

      {!bankEmpty && (
        <Card variant="default" padding="md" style={{ marginBottom: "var(--sp-5)" }}>
          <div style={{ display: "flex", gap: "var(--sp-3)", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <Select
                label="Sujet"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                options={topicOptions}
              />
            </div>
            <Button
              variant="primary"
              icon={loadingQ ? <Loader2 size={16} className="spin" /> : <Shuffle size={16} />}
              onClick={pickRandom}
              disabled={loadingQ || !topic}
            >
              {loadingQ ? "Tirage…" : "Nouvelle question"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={
                importing || bankStatus?.translation?.running ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Download size={14} />
                )
              }
              onClick={importBank}
              disabled={importing || bankStatus?.translation?.running}
              title="Ré-importer depuis GitHub"
            >
              {importing
                ? "Sync…"
                : bankStatus?.translation?.running
                  ? "Traduction…"
                  : "Ré-importer"}
            </Button>
          </div>
          <div
            style={{
              marginTop: "var(--sp-3)",
              fontSize: "var(--text-xs)",
              color: "var(--noir-400)",
            }}
          >
            {bankStatus?.count ?? 0} questions dans la banque ·{" "}
            {bankStatus?.topics.length ?? 0} sujets
            {bankStatus?.translation?.running ? (
              <>
                {" · "}
                <span style={{ color: "var(--amber-400)" }}>
                  traduction {bankStatus.translation.done}/
                  {bankStatus.translation.total}
                </span>
              </>
            ) : null}
          </div>
        </Card>
      )}

      {question && (
        <Card variant="default" padding="lg" style={{ marginBottom: "var(--sp-5)" }}>
          <CardHeader>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-2)",
                width: "100%",
              }}
            >
              <Badge variant="amber" size="sm">
                {question.topic_label}
              </Badge>
              <Badge variant="default" size="sm">
                Q{question.idx}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                icon={<Languages size={14} />}
                onClick={() => setLang((l) => (l === "fr" ? "en" : "fr"))}
                disabled={!enAvailable}
                title={enAvailable ? "Basculer FR/EN" : "VO non disponible (ré-importer)"}
                style={{ marginLeft: "auto" }}
              >
                {lang === "fr" ? "EN" : "FR"}
              </Button>
            </div>
          </CardHeader>
          <div className="md-content" style={{ fontSize: "var(--text-base)" }}>
            {md(displayQ)}
          </div>

          <div style={{ marginTop: "var(--sp-4)" }}>
            <label className="alice-input-group__label">Ta réponse</label>
            <textarea
              className="alice-textarea"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Réponds ouvertement, comme en entretien. Structure ton raisonnement, cite les concepts clés."
              rows={10}
              style={{ marginTop: "var(--sp-1)" }}
            />
          </div>

          <div
            style={{
              display: "flex",
              gap: "var(--sp-2)",
              marginTop: "var(--sp-3)",
              flexWrap: "wrap",
            }}
          >
            <Button
              variant="primary"
              icon={loadingGrade ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
              onClick={submitAnswer}
              disabled={loadingGrade || !answer.trim()}
            >
              {loadingGrade ? "Évaluation…" : "Soumettre"}
            </Button>
            <Button
              variant="secondary"
              icon={loadingHint ? <Loader2 size={16} className="spin" /> : <Lightbulb size={16} />}
              onClick={requestHint}
              disabled={loadingHint}
            >
              {loadingHint ? "Indice…" : "Indice"}
            </Button>
            <Button
              variant="ghost"
              icon={showReference ? <EyeOff size={16} /> : <Eye size={16} />}
              onClick={() => setShowReference((v) => !v)}
            >
              {showReference ? "Masquer la référence" : "Voir la référence"}
            </Button>
          </div>

          {hint && (
            <Card variant="amber" padding="md" style={{ marginTop: "var(--sp-4)" }}>
              <div
                style={{
                  display: "flex",
                  gap: "var(--sp-2)",
                  alignItems: "flex-start",
                }}
              >
                <Lightbulb
                  size={18}
                  style={{ color: "var(--amber-400)", flexShrink: 0, marginTop: 2 }}
                />
                <div className="md-content" style={{ fontSize: "var(--text-sm)" }}>
                  {md(hint)}
                </div>
              </div>
            </Card>
          )}

          {evaluation && <EvaluationCard ev={evaluation} />}

          {showReference && (
            <Card variant="outlined" padding="md" style={{ marginTop: "var(--sp-4)" }}>
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--noir-400)",
                  marginBottom: "var(--sp-2)",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                Réponse de référence
              </div>
              <div className="md-content" style={{ fontSize: "var(--text-sm)" }}>
                {md(displayRef)}
              </div>
            </Card>
          )}
        </Card>
      )}

      {!question && !bankEmpty && !loadingBank && (
        <Card variant="outlined" padding="lg">
          <div
            style={{
              textAlign: "center",
              color: "var(--noir-400)",
              fontSize: "var(--text-sm)",
            }}
          >
            Sélectionne un sujet et clique sur <strong>Nouvelle question</strong> pour commencer.
          </div>
        </Card>
      )}

      <BackToTop />
    </div>
  );
}

function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = document.querySelector(".alice-main__content") as HTMLElement | null;
    if (!el) return;
    const onScroll = () => setVisible(el.scrollTop > 300);
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const scrollUp = () => {
    const el = document.querySelector(".alice-main__content") as HTMLElement | null;
    el?.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={scrollUp}
      aria-label="Revenir en haut"
      style={{
        position: "fixed",
        right: "var(--sp-6)",
        bottom: "var(--sp-6)",
        width: 44,
        height: 44,
        borderRadius: "50%",
        border: "1px solid var(--noir-600)",
        background: "var(--noir-800)",
        color: "var(--amber-400)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        boxShadow: "var(--shadow-md)",
        zIndex: 50,
      }}
    >
      <ArrowUp size={18} />
    </button>
  );
}

function EvaluationCard({ ev }: { ev: Evaluation }) {
  const score = typeof ev.score === "number" ? ev.score : null;
  const scoreColor =
    score === null
      ? "var(--noir-300)"
      : score >= 8
        ? "var(--success-500)"
        : score >= 5
          ? "var(--amber-400)"
          : "var(--danger-500)";

  return (
    <Card variant="elevated" padding="md" style={{ marginTop: "var(--sp-4)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-3)",
          marginBottom: "var(--sp-3)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: "var(--text-2xl)",
            color: scoreColor,
            minWidth: 60,
          }}
        >
          {score !== null ? `${score}/10` : "—"}
        </div>
        <div className="md-inline" style={{ fontSize: "var(--text-sm)", color: "var(--noir-200)" }}>
          {mdInline(ev.verdict)}
        </div>
      </div>

      {ev.points_corrects?.length > 0 && (
        <EvalList
          title="Points corrects"
          items={ev.points_corrects}
          icon={<CheckCircle2 size={14} style={{ color: "var(--success-500)" }} />}
        />
      )}
      {ev.points_manquants?.length > 0 && (
        <EvalList
          title="Points manquants"
          items={ev.points_manquants}
          icon={<AlertCircle size={14} style={{ color: "var(--amber-400)" }} />}
        />
      )}
      {ev.erreurs?.length > 0 && (
        <EvalList
          title="Erreurs"
          items={ev.erreurs}
          icon={<XCircle size={14} style={{ color: "var(--danger-500)" }} />}
        />
      )}
      {ev.enrichissement && (
        <div style={{ marginTop: "var(--sp-3)" }}>
          <div
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--noir-400)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "var(--sp-1)",
            }}
          >
            Enrichissement
          </div>
          <div className="md-content" style={{ fontSize: "var(--text-sm)" }}>
            <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
              {ev.enrichissement}
            </Markdown>
          </div>
        </div>
      )}
    </Card>
  );
}

function EvalList({
  title,
  items,
  icon,
}: {
  title: string;
  items: string[];
  icon: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: "var(--sp-2)" }}>
      <div
        style={{
          fontSize: "var(--text-xs)",
          color: "var(--noir-400)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: "var(--sp-1)",
        }}
      >
        {title}
      </div>
      <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
        {items.map((it, i) => (
          <li
            key={i}
            style={{
              display: "flex",
              gap: "var(--sp-2)",
              alignItems: "flex-start",
              padding: "var(--sp-1) 0",
              fontSize: "var(--text-sm)",
              color: "var(--noir-100)",
            }}
          >
            <span style={{ flexShrink: 0, marginTop: 2 }}>{icon}</span>
            <span className="md-inline">{mdInline(it)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
