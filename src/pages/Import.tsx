import { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload,
  Copy,
  Check,
  AlertCircle,
  CheckCircle2,
  FileText,
  BookOpen,
  Loader2,
  Sparkles,
  RefreshCw,
  Wand2,
} from "lucide-react";
import { apiBase } from "../api";
import { Card, CardHeader, CardBody } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Badge } from "../components/Badge";
import { Tabs } from "../components/Tabs";

interface UploadResult {
  subject_id: string;
  chapter_id: string;
  path: string;
  filename: string;
  index?: { indexed_files?: number; chunks?: number };
  index_error?: string;
}

interface AuthStatus {
  authenticated: boolean;
  message: string;
  status?: "unknown" | "checking" | "login_in_progress" | "ready" | "expired" | "login_failed";
  last_check?: string | null;
}

interface TaskResult {
  subject_id: string;
  chapter_id: string;
  path: string;
  filename: string;
  index?: { indexed_files?: number; chunks?: number };
  index_error?: string;
}

interface TaskState {
  status: "pending" | "running" | "done" | "error";
  stage: string;
  progress_msg: string;
  result?: TaskResult;
  error?: string;
  created_at: string;
}

/* ---- Module-level state: survives component unmount/remount ---- */
let _stash: {
  taskId: string | null;
  startedAt: number | null;
  snapshot: TaskState | null;
  subjectTitle: string;
  chapterTitle: string;
} | null = null;

export function Import() {
  /* ---------- Manual tab state (preserved) ---------- */
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);

  const [subjectTitle, setSubjectTitle] = useState("");
  const [chapterTitle, setChapterTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [err, setErr] = useState("");

  /* ---------- Auto tab state ---------- */
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [autoSubject, setAutoSubject] = useState(() => _stash?.subjectTitle ?? "");
  const [autoChapter, setAutoChapter] = useState(() => _stash?.chapterTitle ?? "");
  const [autoFile, setAutoFile] = useState<File | null>(null);
  const [autoDragOver, setAutoDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(() => _stash?.taskId ?? null);
  const [taskState, setTaskState] = useState<TaskState | null>(() => _stash?.snapshot ?? null);
  const [startedAt, setStartedAt] = useState<number | null>(() => _stash?.startedAt ?? null);
  const [elapsed, setElapsed] = useState(0);
  const [autoErr, setAutoErr] = useState("");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ---------- Manual tab: fetch prompt ---------- */
  useEffect(() => {
    fetch(`${apiBase}/api/notebooklm-prompt`)
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      })
      .then((d: { prompt: string }) => setPrompt(d.prompt))
      .catch((e) => setErr(e instanceof TypeError
        ? "Impossible de contacter le backend — vérifiez qu'il tourne."
        : String(e),
      ));
  }, []);

  function copyPrompt() {
    navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  }, []);

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  }

  async function upload() {
    if (!file || !subjectTitle.trim() || !chapterTitle.trim()) return;
    setErr("");
    setResult(null);
    setLoading(true);

    const form = new FormData();
    form.append("file", file);
    form.append("subject_title", subjectTitle.trim());
    form.append("chapter_title", chapterTitle.trim());
    form.append("reindex", "true");

    try {
      const url = `${apiBase}/api/courses/upload`;
      const r = await fetch(url, { method: "POST", body: form });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || r.statusText);
      }
      const data: UploadResult = await r.json();
      setResult(data);
      setFile(null);
    } catch (e) {
      const msg = e instanceof TypeError
        ? "Impossible de contacter le backend — vérifiez qu'il tourne."
        : String(e);
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }

  const canUpload = file && subjectTitle.trim() && chapterTitle.trim();

  /* ---------- Auto tab: auth status ---------- */
  const fetchAuthStatus = useCallback(async () => {
    setAuthLoading(true);
    try {
      const r = await fetch(`${apiBase}/api/notebooklm/status`);
      if (!r.ok) throw new Error(r.statusText);
      const data: AuthStatus = await r.json();
      setAuthStatus(data);
    } catch (e) {
      setAuthStatus({
        authenticated: false,
        message:
          e instanceof TypeError
            ? "Impossible de contacter le backend — vérifiez qu'il tourne."
            : String(e),
      });
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const refreshAuth = useCallback(async () => {
    setAuthLoading(true);
    try {
      const r = await fetch(`${apiBase}/api/notebooklm/refresh`, { method: "POST" });
      if (!r.ok) throw new Error(r.statusText);
      const data: AuthStatus = await r.json();
      setAuthStatus(data);
    } catch (e) {
      setAuthStatus({
        authenticated: false,
        message: e instanceof TypeError ? "Impossible de contacter le backend." : String(e),
      });
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAuthStatus();
  }, [fetchAuthStatus]);

  // Poll while the backend is still doing its automatic probe/login on boot.
  useEffect(() => {
    const s = authStatus?.status;
    if (s !== "checking" && s !== "login_in_progress" && s !== "unknown") return;
    const id = setInterval(fetchAuthStatus, 2000);
    return () => clearInterval(id);
  }, [authStatus?.status, fetchAuthStatus]);

  /* ---------- Auto tab: persistent stash sync ---------- */
  useEffect(() => {
    if (_stash) {
      _stash.subjectTitle = autoSubject;
      _stash.chapterTitle = autoChapter;
    }
  }, [autoSubject, autoChapter]);

  /* ---------- Auto tab: polling ---------- */
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const stopTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const pollTask = useCallback(
    async (id: string) => {
      try {
        const r = await fetch(`${apiBase}/api/notebooklm/task/${id}`);
        if (!r.ok) throw new Error(r.statusText);
        const data: TaskState = await r.json();
        setTaskState(data);
        if (_stash) _stash.snapshot = data;
        if (data.status === "done" || data.status === "error") {
          stopPolling();
          stopTick();
          if (_stash) {
            _stash.taskId = null;
            _stash.startedAt = null;
          }
        }
      } catch (e) {
        setAutoErr(
          e instanceof TypeError
            ? "Impossible de contacter le backend — vérifiez qu'il tourne."
            : String(e),
        );
      }
    },
    [stopPolling, stopTick],
  );

  const startPolling = useCallback(
    (id: string, started: number) => {
      stopPolling();
      stopTick();
      // Immediate poll, then every 2s
      void pollTask(id);
      pollRef.current = setInterval(() => {
        void pollTask(id);
      }, 2000);
      setElapsed(Math.floor((Date.now() - started) / 1000));
      tickRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - started) / 1000));
      }, 1000);
    },
    [pollTask, stopPolling, stopTick],
  );

  /* On mount: resume polling if a task is stashed and still running */
  useEffect(() => {
    if (taskId && startedAt && (!taskState || taskState.status === "pending" || taskState.status === "running")) {
      startPolling(taskId, startedAt);
    }
    return () => {
      stopPolling();
      stopTick();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startGeneration() {
    if (!autoFile || !autoSubject.trim() || !autoChapter.trim()) return;
    if (!authStatus?.authenticated) return;
    setAutoErr("");
    setSubmitting(true);
    setTaskState(null);

    const form = new FormData();
    form.append("file", autoFile);
    form.append("subject_title", autoSubject.trim());
    form.append("chapter_title", autoChapter.trim());
    form.append("reindex", "true");

    try {
      const r = await fetch(`${apiBase}/api/notebooklm/generate`, {
        method: "POST",
        body: form,
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || r.statusText);
      }
      const data: { task_id: string } = await r.json();
      const started = Date.now();
      setTaskId(data.task_id);
      setStartedAt(started);
      _stash = {
        taskId: data.task_id,
        startedAt: started,
        snapshot: null,
        subjectTitle: autoSubject,
        chapterTitle: autoChapter,
      };
      startPolling(data.task_id, started);
    } catch (e) {
      setAutoErr(
        e instanceof TypeError
          ? "Impossible de contacter le backend — vérifiez qu'il tourne."
          : String(e),
      );
    } finally {
      setSubmitting(false);
    }
  }

  function resetAutoFlow() {
    stopPolling();
    stopTick();
    setTaskId(null);
    setTaskState(null);
    setStartedAt(null);
    setElapsed(0);
    setAutoFile(null);
    setAutoErr("");
    _stash = null;
  }

  const handleAutoDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setAutoDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) setAutoFile(f);
  }, []);

  function handleAutoFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setAutoFile(f);
  }

  function formatElapsed(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }

  const authed = !!authStatus?.authenticated;
  const taskRunning =
    !!taskId && (!taskState || taskState.status === "pending" || taskState.status === "running");
  const taskDone = taskState?.status === "done";
  const taskError = taskState?.status === "error";
  const canGenerate =
    authed && !!autoFile && !!autoSubject.trim() && !!autoChapter.trim() && !submitting && !taskRunning;

  /* ---------- Renderers ---------- */

  function renderAuthPanel() {
    const s = authStatus?.status;
    const autoInProgress = s === "checking" || s === "login_in_progress" || s === "unknown";
    return (
      <Card variant="default" padding="md" style={{ marginBottom: "var(--sp-4)" }}>
        {autoInProgress && !authed ? (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", color: "var(--noir-300)" }}>
            <Loader2 size={16} className="spin" style={{ color: "var(--amber-400)" }} />
            <span style={{ fontSize: "var(--text-sm)" }}>
              {s === "login_in_progress"
                ? "Reconnexion automatique à NotebookLM en cours…"
                : "Vérification de la session NotebookLM…"}
            </span>
          </div>
        ) : authLoading && !authStatus ? (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", color: "var(--noir-400)" }}>
            <Loader2 size={16} className="spin" />
            <span>Vérification de la connexion NotebookLM...</span>
          </div>
        ) : authed ? (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
            <Badge variant="success" size="sm">NotebookLM connecté</Badge>
            <span style={{ fontSize: "var(--text-sm)", color: "var(--noir-300)" }}>
              {authStatus?.message}
            </span>
            <div style={{ marginLeft: "auto" }}>
              <Button
                variant="ghost"
                size="sm"
                icon={<RefreshCw size={12} className={authLoading ? "spin" : ""} />}
                onClick={fetchAuthStatus}
                disabled={authLoading}
              >
                Re-vérifier
              </Button>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--sp-3)",
              padding: "var(--sp-3)",
              border: "1px solid var(--amber-400)",
              borderRadius: "var(--radius-md)",
              background: "rgba(212, 160, 74, 0.06)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
              <AlertCircle size={16} style={{ color: "var(--amber-400)" }} />
              <span style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>
                NotebookLM non connecté
              </span>
            </div>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--noir-300)", margin: 0 }}>
              {authStatus?.message}
            </p>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--noir-300)", margin: 0 }}>
              ALICE tente une reconnexion automatique au lancement. Si elle échoue
              (pas de session Google valide dans le profil Chromium), ouvrez un
              terminal et lancez une fois :{" "}
              <code
                style={{
                  background: "var(--noir-800)",
                  padding: "2px 6px",
                  borderRadius: "var(--radius-sm)",
                  fontFamily: "var(--font-mono, monospace)",
                }}
              >
                notebooklm login
              </code>
              .
            </p>
            <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
              <Button
                variant="primary"
                size="sm"
                icon={<RefreshCw size={12} className={authLoading ? "spin" : ""} />}
                onClick={refreshAuth}
                disabled={authLoading}
              >
                Relancer la connexion auto
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<RefreshCw size={12} className={authLoading ? "spin" : ""} />}
                onClick={fetchAuthStatus}
                disabled={authLoading}
              >
                Re-vérifier
              </Button>
            </div>
          </div>
        )}
      </Card>
    );
  }

  function renderResultCard(res: TaskResult | UploadResult) {
    return (
      <Card variant="default" padding="md" className="animate-fade-in">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", marginBottom: "var(--sp-4)" }}>
          <CheckCircle2 size={20} style={{ color: "var(--success-500)" }} />
          <span style={{ fontWeight: 600, fontSize: "var(--text-md)" }}>
            Chapitre importé
          </span>
        </div>
        <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap", marginBottom: "var(--sp-3)" }}>
          <Badge variant="amber" size="sm">{res.subject_id}</Badge>
          <Badge variant="default" size="sm">{res.chapter_id}</Badge>
        </div>
        <p style={{ fontSize: "var(--text-xs)", color: "var(--noir-400)", margin: "0 0 var(--sp-2)" }}>
          Fichier : <code>{res.filename}</code> dans <code>subjects/{res.path}/</code>
        </p>
        {res.index && (
          <p style={{ fontSize: "var(--text-xs)", color: "var(--noir-400)", margin: 0 }}>
            RAG : {res.index.indexed_files ?? "?"} fichiers indexés, {res.index.chunks ?? "?"} chunks
          </p>
        )}
        {res.index_error && (
          <p style={{ fontSize: "var(--text-xs)", color: "var(--danger-500)", margin: 0 }}>
            Erreur index : {res.index_error}
          </p>
        )}
      </Card>
    );
  }

  function renderAutoTab() {
    const dim = !authed;
    return (
      <div>
        {autoErr && (
          <div className="error-banner">
            <span className="error-banner__icon">
              <AlertCircle size={16} />
            </span>
            {autoErr}
          </div>
        )}

        {renderAuthPanel()}

        <Card
          variant="default"
          padding="none"
          style={{ opacity: dim ? 0.55 : 1, pointerEvents: dim ? "none" : "auto" }}
        >
          <CardHeader>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
              <Wand2 size={18} style={{ color: "var(--amber-400)" }} />
              <span style={{ fontWeight: 600, fontSize: "var(--text-md)" }}>
                Génération automatique via NotebookLM
              </span>
            </div>
          </CardHeader>
          <CardBody>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)", padding: "0 var(--sp-5) var(--sp-5)" }}>
              <Input
                label="Matière"
                value={autoSubject}
                onChange={(e) => setAutoSubject(e.target.value)}
                placeholder="ex: Data Science"
                hint="Nom de la matière (existante ou nouvelle)"
                disabled={taskRunning}
              />
              <Input
                label="Chapitre"
                value={autoChapter}
                onChange={(e) => setAutoChapter(e.target.value)}
                placeholder="ex: Fondamentaux des Réseaux Complexes"
                hint="Nom du chapitre à créer"
                disabled={taskRunning}
              />

              <div
                onDragOver={(e) => { e.preventDefault(); setAutoDragOver(true); }}
                onDragLeave={() => setAutoDragOver(false)}
                onDrop={handleAutoDrop}
                style={{
                  border: `2px dashed ${autoDragOver ? "var(--amber-400)" : "var(--noir-600)"}`,
                  borderRadius: "var(--radius-md)",
                  padding: "var(--sp-6)",
                  textAlign: "center",
                  cursor: taskRunning ? "not-allowed" : "pointer",
                  transition: "border-color 0.2s, background 0.2s",
                  background: autoDragOver ? "rgba(212, 160, 74, 0.06)" : "transparent",
                  opacity: taskRunning ? 0.6 : 1,
                }}
                onClick={() => {
                  if (taskRunning) return;
                  document.getElementById("auto-file-input")?.click();
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (taskRunning) return;
                  if (e.key === "Enter" || e.key === " ") {
                    document.getElementById("auto-file-input")?.click();
                  }
                }}
              >
                <input
                  id="auto-file-input"
                  type="file"
                  accept=".pdf,.md,.markdown,.txt,.docx"
                  onChange={handleAutoFileInput}
                  style={{ display: "none" }}
                  disabled={taskRunning}
                />
                {autoFile ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--sp-3)" }}>
                    <FileText size={20} style={{ color: "var(--amber-400)" }} />
                    <span style={{ fontSize: "var(--text-sm)", color: "var(--noir-200)", fontWeight: 500 }}>
                      {autoFile.name}
                    </span>
                    <Badge variant="amber" size="sm">
                      {(autoFile.size / 1024).toFixed(0)} Ko
                    </Badge>
                  </div>
                ) : (
                  <>
                    <Upload size={28} style={{ color: "var(--noir-500)", marginBottom: "var(--sp-2)" }} />
                    <p style={{ fontSize: "var(--text-sm)", color: "var(--noir-400)", margin: 0 }}>
                      Glissez un fichier ici ou cliquez pour parcourir
                    </p>
                    <p style={{ fontSize: "var(--text-xs)", color: "var(--noir-500)", margin: "var(--sp-1) 0 0" }}>
                      .pdf, .md, .txt, .docx
                    </p>
                  </>
                )}
              </div>

              <Button
                variant="primary"
                icon={submitting ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                loading={submitting}
                disabled={!canGenerate}
                onClick={startGeneration}
              >
                {submitting ? "Démarrage..." : "Générer le cours via NotebookLM"}
              </Button>
            </div>
          </CardBody>
        </Card>

        {taskRunning && taskState && (
          <div style={{ marginTop: "var(--sp-4)" }}>
            <Card variant="default" padding="md" className="animate-fade-in">
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", marginBottom: "var(--sp-3)" }}>
                <Loader2 size={20} className="spin" style={{ color: "var(--amber-400)", flexShrink: 0 }} />
                <span style={{ fontWeight: 600, fontSize: "var(--text-md)" }}>
                  Génération en cours
                </span>
                <div style={{ marginLeft: "auto" }}>
                  <Badge variant="amber" size="sm">{formatElapsed(elapsed)}</Badge>
                </div>
              </div>
              <p style={{ fontSize: "var(--text-sm)", color: "var(--noir-300)", margin: "0 0 var(--sp-2)" }}>
                {taskState.progress_msg || "Initialisation..."}
              </p>
              <p style={{ fontSize: "var(--text-xs)", color: "var(--noir-500)", margin: 0 }}>
                Ne ferme pas l'application. Tu peux cependant naviguer vers d'autres pages — la progression sera conservée.
              </p>
            </Card>
          </div>
        )}

        {taskRunning && !taskState && (
          <div style={{ marginTop: "var(--sp-4)" }}>
            <Card variant="default" padding="md" className="animate-fade-in">
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                <Loader2 size={18} className="spin" style={{ color: "var(--amber-400)" }} />
                <span style={{ fontSize: "var(--text-sm)", color: "var(--noir-300)" }}>
                  Démarrage de la tâche...
                </span>
                <div style={{ marginLeft: "auto" }}>
                  <Badge variant="amber" size="sm">{formatElapsed(elapsed)}</Badge>
                </div>
              </div>
            </Card>
          </div>
        )}

        {taskDone && taskState?.result && (
          <div style={{ marginTop: "var(--sp-4)" }}>
            {renderResultCard(taskState.result)}
            <div style={{ marginTop: "var(--sp-3)", display: "flex", gap: "var(--sp-2)" }}>
              <Button variant="secondary" size="sm" icon={<Sparkles size={12} />} onClick={resetAutoFlow}>
                Nouveau cours
              </Button>
            </div>
          </div>
        )}

        {taskError && (
          <div style={{ marginTop: "var(--sp-4)" }}>
            <div className="error-banner">
              <span className="error-banner__icon">
                <AlertCircle size={16} />
              </span>
              {taskState?.error || "Erreur inconnue pendant la génération."}
            </div>
            <div style={{ marginTop: "var(--sp-3)", display: "flex", gap: "var(--sp-2)" }}>
              <Button variant="secondary" size="sm" icon={<RefreshCw size={12} />} onClick={resetAutoFlow}>
                Réessayer
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderManualTab() {
    return (
      <div>
        {err && (
          <div className="error-banner">
            <span className="error-banner__icon">
              <AlertCircle size={16} />
            </span>
            {err}
          </div>
        )}

        <div className="settings-grid">
          {/* Step 1: NotebookLM prompt */}
          <Card variant="default" padding="none">
            <CardHeader>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                <BookOpen size={18} style={{ color: "var(--amber-400)" }} />
                <span style={{ fontWeight: 600, fontSize: "var(--text-md)" }}>
                  Étape 1 — Prompt NotebookLM
                </span>
              </div>
              <Button
                variant={copied ? "ghost" : "secondary"}
                size="sm"
                icon={copied ? <Check size={14} /> : <Copy size={14} />}
                onClick={copyPrompt}
                disabled={!prompt}
              >
                {copied ? "Copié !" : "Copier"}
              </Button>
            </CardHeader>
            <CardBody>
              <div style={{ padding: "0 var(--sp-5) var(--sp-5)" }}>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--noir-300)", marginBottom: "var(--sp-3)" }}>
                  Copiez ce prompt et collez-le dans NotebookLM comme instruction
                  système, avec vos slides en source. NotebookLM générera un cours
                  Markdown structuré.
                </p>
                <div
                  style={{
                    maxHeight: 200,
                    overflowY: "auto",
                    background: "var(--noir-800)",
                    borderRadius: "var(--radius-sm)",
                    padding: "var(--sp-3)",
                    fontSize: "var(--text-xs)",
                    color: "var(--noir-300)",
                    lineHeight: "var(--leading-relaxed)",
                    whiteSpace: "pre-wrap",
                    fontFamily: "var(--font-mono, monospace)",
                    border: "1px solid var(--noir-700)",
                  }}
                >
                  {prompt || "Chargement..."}
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Step 2: Upload */}
          <Card variant="default" padding="none">
            <CardHeader>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                <Upload size={18} style={{ color: "var(--amber-400)" }} />
                <span style={{ fontWeight: 600, fontSize: "var(--text-md)" }}>
                  Étape 2 — Importer le fichier
                </span>
              </div>
            </CardHeader>
            <CardBody>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)", padding: "0 var(--sp-5) var(--sp-5)" }}>
                <Input
                  label="Matière"
                  value={subjectTitle}
                  onChange={(e) => setSubjectTitle(e.target.value)}
                  placeholder="ex: Data Science"
                  hint="Nom de la matière (existante ou nouvelle)"
                />
                <Input
                  label="Chapitre"
                  value={chapterTitle}
                  onChange={(e) => setChapterTitle(e.target.value)}
                  placeholder="ex: Fondamentaux des Réseaux Complexes"
                  hint="Nom du chapitre à créer"
                />

                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  style={{
                    border: `2px dashed ${dragOver ? "var(--amber-400)" : "var(--noir-600)"}`,
                    borderRadius: "var(--radius-md)",
                    padding: "var(--sp-6)",
                    textAlign: "center",
                    cursor: "pointer",
                    transition: "border-color 0.2s, background 0.2s",
                    background: dragOver ? "rgba(212, 160, 74, 0.06)" : "transparent",
                  }}
                  onClick={() => document.getElementById("file-input")?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      document.getElementById("file-input")?.click();
                    }
                  }}
                >
                  <input
                    id="file-input"
                    type="file"
                    accept=".md,.markdown,.txt,.pdf"
                    onChange={handleFileInput}
                    style={{ display: "none" }}
                  />
                  {file ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--sp-3)" }}>
                      <FileText size={20} style={{ color: "var(--amber-400)" }} />
                      <span style={{ fontSize: "var(--text-sm)", color: "var(--noir-200)", fontWeight: 500 }}>
                        {file.name}
                      </span>
                      <Badge variant="amber" size="sm">
                        {(file.size / 1024).toFixed(0)} Ko
                      </Badge>
                    </div>
                  ) : (
                    <>
                      <Upload size={28} style={{ color: "var(--noir-500)", marginBottom: "var(--sp-2)" }} />
                      <p style={{ fontSize: "var(--text-sm)", color: "var(--noir-400)", margin: 0 }}>
                        Glissez un fichier ici ou cliquez pour parcourir
                      </p>
                      <p style={{ fontSize: "var(--text-xs)", color: "var(--noir-500)", margin: "var(--sp-1) 0 0" }}>
                        .md, .txt, .pdf
                      </p>
                    </>
                  )}
                </div>

                <Button
                  variant="primary"
                  icon={loading ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
                  loading={loading}
                  disabled={loading || !canUpload}
                  onClick={upload}
                >
                  {loading ? "Import en cours..." : "Importer et indexer"}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>

        {result && (
          <div style={{ marginTop: "var(--sp-6)" }}>
            {renderResultCard(result)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Importer un cours</h1>
        <p className="page-header__subtitle">
          Générez automatiquement via NotebookLM ou importez un markdown existant.
        </p>
      </div>

      <Tabs
        tabs={[
          { id: "auto", label: "Automatique", icon: <Wand2 size={14} /> },
          { id: "manual", label: "Manuel", icon: <Upload size={14} /> },
        ]}
        defaultTab="auto"
      >
        {(active) => (active === "auto" ? renderAutoTab() : renderManualTab())}
      </Tabs>
    </div>
  );
}
