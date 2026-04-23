import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import {
  BarChart3,
  BookOpen,
  Brain,
  CheckCircle2,
  MessageSquare,
  TrendingUp,
  Trophy,
  Target,
  XCircle,
  Lightbulb,
  Loader2,
} from "lucide-react";
import Markdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { api } from "../api";
import { Card } from "../components/Card";
import { Modal } from "../components/Modal";

interface QuizEntry {
  id?: number;
  chapter_id: string;
  score: number;
  total: number;
  created_at: string;
  has_details?: boolean;
}

interface AttemptDetailItem {
  q: string;
  options: string[];
  correct: number;
  user_answer: number;
  hint?: string;
  rationales?: string[];
}

interface AttemptDetail {
  id: number;
  chapter_id: string;
  score: number;
  total: number;
  created_at: string;
  details: AttemptDetailItem[] | null;
}

interface ChapterEntry {
  chapter_id: string;
  completed_at: string;
}

/* Custom tooltip for recharts */
function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      <div className="custom-tooltip__label">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="custom-tooltip__value" style={{ color: p.color }}>
          {p.name}: {p.value}
          {p.name === "Score" ? "%" : ""}
        </div>
      ))}
    </div>
  );
}

export function Dashboard() {
  const [quizHistory, setQuizHistory] = useState<QuizEntry[]>([]);
  const [chapters, setChapters] = useState<ChapterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [openAttemptId, setOpenAttemptId] = useState<number | null>(null);
  const [attemptDetail, setAttemptDetail] = useState<AttemptDetail | null>(null);
  const [attemptLoading, setAttemptLoading] = useState(false);
  const [attemptErr, setAttemptErr] = useState("");

  async function openAttempt(id: number) {
    setOpenAttemptId(id);
    setAttemptDetail(null);
    setAttemptErr("");
    setAttemptLoading(true);
    try {
      const d = await api<AttemptDetail>(`/api/quiz/attempt/${id}`);
      setAttemptDetail(d);
    } catch (e) {
      setAttemptErr(String(e));
    } finally {
      setAttemptLoading(false);
    }
  }

  function closeAttempt() {
    setOpenAttemptId(null);
    setAttemptDetail(null);
    setAttemptErr("");
  }

  useEffect(() => {
    Promise.all([
      api<QuizEntry[]>("/api/progress/quiz").catch(() => []),
      api<ChapterEntry[]>("/api/progress/chapters").catch(() => []),
    ]).then(([q, c]) => {
      setQuizHistory(q);
      setChapters(c);
      setLoading(false);
    });
  }, []);

  // Prepare chart data from quiz history
  const quizChartData = quizHistory.slice(-20).map((q, i) => ({
    name: `Q${i + 1}`,
    Score: Math.round((q.score / q.total) * 100),
    date: q.created_at?.slice(0, 10) ?? "",
  }));

  // Average score
  const avgScore =
    quizHistory.length > 0
      ? Math.round(
          (quizHistory.reduce((acc, q) => acc + (q.score / q.total) * 100, 0) /
            quizHistory.length)
        )
      : 0;

  // Best score
  const bestScore =
    quizHistory.length > 0
      ? Math.round(
          Math.max(...quizHistory.map((q) => (q.score / q.total) * 100))
        )
      : 0;

  // Chapter count per subject (from chapter IDs)
  const chaptersByDay = chapters.reduce<Record<string, number>>((acc, c) => {
    const day = c.completed_at?.slice(0, 10) ?? "inconnu";
    acc[day] = (acc[day] || 0) + 1;
    return acc;
  }, {});

  const chapterChartData = Object.entries(chaptersByDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([date, count]) => ({
      name: date.slice(5), // MM-DD
      Chapitres: count,
    }));

  // Recent trend (last 5 vs previous 5)
  const recentQuizzes = quizHistory.slice(-5);
  const prevQuizzes = quizHistory.slice(-10, -5);
  const recentAvg =
    recentQuizzes.length > 0
      ? recentQuizzes.reduce((a, q) => a + (q.score / q.total) * 100, 0) /
        recentQuizzes.length
      : 0;
  const prevAvg =
    prevQuizzes.length > 0
      ? prevQuizzes.reduce((a, q) => a + (q.score / q.total) * 100, 0) /
        prevQuizzes.length
      : 0;
  const trend = recentAvg - prevAvg;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Tableau de bord</h1>
        <p className="page-header__subtitle">
          Suivez votre progression, vos scores de quiz et votre activite
          d'apprentissage.
        </p>
      </div>

      {loading ? (
        <div className="dashboard-grid">
          {[1, 2, 3].map((i) => (
            <Card key={i} variant="default" padding="md">
              <div className="skeleton skeleton--heading" />
              <div className="skeleton skeleton--text" style={{ width: "40%" }} />
            </Card>
          ))}
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="dashboard-grid">
            <Card
              variant="default"
              padding="md"
              className="stat-card delay-1"
            >
              <div className="stat-card__header">
                <div>
                  <div className="stat-card__value">{quizHistory.length}</div>
                  <div className="stat-card__label">Quiz completes</div>
                </div>
                <div className="stat-card__icon stat-card__icon--amber">
                  <Brain size={20} />
                </div>
              </div>
              {trend !== 0 && quizHistory.length > 5 && (
                <div
                  className={`stat-card__trend ${trend > 0 ? "stat-card__trend--up" : "stat-card__trend--down"}`}
                >
                  <TrendingUp
                    size={12}
                    style={{
                      transform: trend < 0 ? "rotate(180deg)" : undefined,
                    }}
                  />
                  {trend > 0 ? "+" : ""}
                  {Math.round(trend)}% vs precedent
                </div>
              )}
            </Card>

            <Card
              variant="default"
              padding="md"
              className="stat-card delay-2"
            >
              <div className="stat-card__header">
                <div>
                  <div className="stat-card__value">{avgScore}%</div>
                  <div className="stat-card__label">Score moyen</div>
                </div>
                <div className="stat-card__icon stat-card__icon--success">
                  <Target size={20} />
                </div>
              </div>
              <div className="stat-card__trend stat-card__trend--up">
                <Trophy size={12} />
                Meilleur : {bestScore}%
              </div>
            </Card>

            <Card
              variant="default"
              padding="md"
              className="stat-card delay-3"
            >
              <div className="stat-card__header">
                <div>
                  <div className="stat-card__value">{chapters.length}</div>
                  <div className="stat-card__label">Chapitres parcourus</div>
                </div>
                <div className="stat-card__icon stat-card__icon--info">
                  <BookOpen size={20} />
                </div>
              </div>
            </Card>
          </div>

          {/* Charts */}
          <div className="dashboard-charts">
            {/* Score evolution */}
            <Card variant="default" padding="md" className="chart-card">
              <div className="chart-card__title">
                <BarChart3
                  size={16}
                  style={{
                    display: "inline",
                    verticalAlign: "middle",
                    marginRight: 8,
                    color: "var(--amber-400)",
                  }}
                />
                Evolution des scores
              </div>
              {quizChartData.length > 0 ? (
                <div style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={quizChartData}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="scoreGradient"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#d4a04a"
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="95%"
                            stopColor="#d4a04a"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--noir-700)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="name"
                        stroke="var(--noir-500)"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke="var(--noir-500)"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        domain={[0, 100]}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="Score"
                        stroke="#d4a04a"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#scoreGradient)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div
                  style={{
                    height: 260,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--noir-400)",
                    fontSize: "var(--text-sm)",
                  }}
                >
                  Aucune donnee de quiz disponible
                </div>
              )}
            </Card>

            {/* Chapters per day */}
            <Card variant="default" padding="md" className="chart-card">
              <div className="chart-card__title">
                <BookOpen
                  size={16}
                  style={{
                    display: "inline",
                    verticalAlign: "middle",
                    marginRight: 8,
                    color: "var(--info-500)",
                  }}
                />
                Activite
              </div>
              {chapterChartData.length > 0 ? (
                <div style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chapterChartData}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--noir-700)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="name"
                        stroke="var(--noir-500)"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke="var(--noir-500)"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar
                        dataKey="Chapitres"
                        fill="var(--info-500)"
                        radius={[4, 4, 0, 0]}
                        barSize={24}
                        opacity={0.8}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div
                  style={{
                    height: 260,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--noir-400)",
                    fontSize: "var(--text-sm)",
                  }}
                >
                  Aucune activite enregistree
                </div>
              )}
            </Card>
          </div>

          {/* Recent quiz list */}
          {quizHistory.length > 0 && (
            <Card variant="default" padding="md" className="animate-fade-in-up delay-4">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-3)",
                  marginBottom: "var(--sp-4)",
                }}
              >
                <MessageSquare
                  size={16}
                  style={{ color: "var(--amber-400)" }}
                />
                <span style={{ fontWeight: 600 }}>Derniers quiz</span>
              </div>
              {quizHistory.slice(-10).reverse().map((q, i) => {
                const pct = Math.round((q.score / q.total) * 100);
                const clickable = !!q.id && !!q.has_details;
                return (
                  <div
                    key={q.id ?? i}
                    className="quiz-history__item"
                    style={{
                      gap: "var(--sp-4)",
                      cursor: clickable ? "pointer" : "default",
                      opacity: clickable ? 1 : 0.75,
                    }}
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={() => clickable && openAttempt(q.id!)}
                    onKeyDown={(e) => {
                      if (!clickable) return;
                      if (e.key === "Enter" || e.key === " ") openAttempt(q.id!);
                    }}
                    title={clickable ? "Voir le détail" : "Détail indisponible"}
                  >
                    <span className="quiz-history__chapter">
                      {q.chapter_id}
                    </span>
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: "var(--text-sm)",
                        color:
                          pct >= 80
                            ? "var(--success-500)"
                            : pct >= 50
                              ? "var(--amber-400)"
                              : "var(--danger-500)",
                      }}
                    >
                      {q.score}/{q.total} ({pct}%)
                    </span>
                    <span className="quiz-history__date">
                      {q.created_at?.slice(0, 16).replace("T", " ") ?? ""}
                    </span>
                  </div>
                );
              })}
            </Card>
          )}
        </>
      )}

      <Modal
        open={openAttemptId !== null}
        onClose={closeAttempt}
        title={
          attemptDetail
            ? `Quiz — ${attemptDetail.chapter_id} (${attemptDetail.score}/${attemptDetail.total})`
            : "Quiz"
        }
        className="alice-modal--wide"
      >
        {attemptLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", color: "var(--noir-400)" }}>
            <Loader2 size={14} className="spin" />
            <span>Chargement...</span>
          </div>
        )}
        {attemptErr && (
          <div className="error-banner">{attemptErr}</div>
        )}
        {attemptDetail && !attemptLoading && (
          <>
            {!attemptDetail.details && (
              <div style={{ color: "var(--noir-400)", fontStyle: "italic" }}>
                Détail indisponible pour cet essai (antérieur à la revue complète).
              </div>
            )}
            {attemptDetail.details && attemptDetail.details.map((d, i) => (
              <Card
                key={i}
                variant="default"
                padding="md"
                className="quiz-question"
                style={{ marginBottom: "var(--sp-3)" }}
              >
                <div className="quiz-question__number">
                  Question {i + 1} sur {attemptDetail.details!.length}
                  {d.user_answer === d.correct ? (
                    <span style={{ marginLeft: "var(--sp-2)", color: "var(--success-500)" }}>
                      <CheckCircle2 size={14} style={{ display: "inline", verticalAlign: "middle" }} /> correcte
                    </span>
                  ) : (
                    <span style={{ marginLeft: "var(--sp-2)", color: "var(--danger-500)" }}>
                      <XCircle size={14} style={{ display: "inline", verticalAlign: "middle" }} />{" "}
                      {d.user_answer < 0 ? "non répondue" : "incorrecte"}
                    </span>
                  )}
                </div>
                <div className="quiz-question__text md-content md-content--inline">
                  <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{d.q}</Markdown>
                </div>
                {d.options.map((opt, j) => {
                  const isCorrect = j === d.correct;
                  const isUser = j === d.user_answer;
                  let cls = "quiz-option";
                  if (isCorrect) cls += " quiz-option--correct";
                  else if (isUser) cls += " quiz-option--wrong";
                  const rationale = d.rationales?.[j] ?? "";
                  return (
                    <div key={j}>
                      <div className={cls}>
                        <span style={{ display: "flex", flexShrink: 0 }}>
                          {isCorrect ? (
                            <CheckCircle2 size={18} style={{ color: "var(--success-500)" }} />
                          ) : isUser ? (
                            <XCircle size={18} style={{ color: "var(--danger-500)" }} />
                          ) : (
                            <span className="quiz-option__radio" />
                          )}
                        </span>
                        <span className="quiz-option__letter">{String.fromCharCode(65 + j)}</span>
                        <span className="md-content md-content--inline">
                          <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{opt}</Markdown>
                        </span>
                      </div>
                      {rationale && (isUser || isCorrect) && (
                        <div
                          className="quiz-rationale md-content md-content--inline"
                          style={{
                            marginLeft: "var(--sp-7)",
                            marginTop: "calc(var(--sp-1) * -1)",
                            marginBottom: "var(--sp-2)",
                            fontSize: "0.85rem",
                            color: "var(--noir-300)",
                            lineHeight: 1.5,
                          }}
                        >
                          <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{rationale}</Markdown>
                        </div>
                      )}
                    </div>
                  );
                })}
                {d.hint && (
                  <div
                    className="md-content md-content--inline"
                    style={{
                      marginTop: "var(--sp-2)",
                      padding: "var(--sp-2) var(--sp-3)",
                      background: "var(--amber-50, rgba(251,191,36,0.08))",
                      borderLeft: "3px solid var(--amber-400)",
                      borderRadius: "var(--radius-sm, 4px)",
                      fontSize: "0.88rem",
                      color: "var(--noir-200)",
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "var(--sp-2)",
                    }}
                  >
                    <Lightbulb size={14} style={{ marginTop: "2px", flexShrink: 0, color: "var(--amber-400)" }} />
                    <div>
                      <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{d.hint}</Markdown>
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </>
        )}
      </Modal>
    </div>
  );
}
