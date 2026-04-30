import { useEffect, useMemo, useRef, useState } from "react";
import {
  Podcast,
  Plus,
  Search,
  Trash2,
  Copy,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Cpu,
  X,
} from "lucide-react";
import { api } from "../api";
import { Card, CardHeader, CardBody } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Badge } from "../components/Badge";
import { notify } from "../components/Notifications";

type PodcastStatus =
  | "pending"
  | "resolving"
  | "downloading"
  | "transcribing"
  | "cleaning"
  | "done"
  | "error";

interface PodcastListRow {
  id: number;
  spotify_url: string;
  spotify_episode_id: string;
  show_name: string;
  episode_title: string;
  published_at: string | null;
  duration_sec: number | null;
  language: string | null;
  model_used: string;
  status: PodcastStatus;
  error: string | null;
  created_at: string;
}

interface Segment {
  start: number;
  end: number;
  text: string;
}

interface PodcastDetail extends PodcastListRow {
  segments: Segment[];
  full_text?: string;
  audio_url?: string;
}

interface JobStatus {
  id: number;
  status: PodcastStatus;
  stage: string;
  message: string;
  error: string | null;
  progress: number | null;
  started_at: number | null;
}

interface TranscriptionInfo {
  available: boolean;
  backend?: "cuda" | "vulkan";
  model?: string;
  compute_type?: string;
  device_name?: string;
  vram_gb?: number | null;
  error?: string;
}

const STAGE_LABEL: Record<string, string> = {
  pending: "En attente",
  resolving: "Résolution",
  downloading: "Téléchargement",
  transcribing: "Transcription",
  cleaning: "Nettoyage",
  done: "Terminé",
  error: "Erreur",
};

const STAGE_VARIANT: Record<string, "default" | "info" | "amber" | "success" | "danger"> = {
  pending: "default",
  resolving: "info",
  downloading: "info",
  transcribing: "amber",
  cleaning: "amber",
  done: "success",
  error: "danger",
};

function formatDuration(sec: number | null): string {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}`;
  return `${m}m${String(s).padStart(2, "0")}`;
}

function formatTimestamp(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatElapsed(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function Podcasts() {
  const [url, setUrl] = useState("");
  const [list, setList] = useState<PodcastListRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PodcastDetail | null>(null);
  const [jobs, setJobs] = useState<Record<number, JobStatus>>({});
  const [info, setInfo] = useState<TranscriptionInfo | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<PodcastListRow[] | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [, setTick] = useState(0);
  const pollRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const metaSeenRef = useRef<Set<number>>(new Set());
  const notifiedRef = useRef<Set<number>>(new Set());

  async function loadList() {
    try {
      const rows = await api<PodcastListRow[]>("/api/podcasts/list");
      setList(rows);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function loadInfo() {
    try {
      const r = await api<TranscriptionInfo>("/api/podcasts/transcription/info");
      setInfo(r);
    } catch (e) {
      setInfo({ available: false, error: String(e) });
    }
  }

  useEffect(() => {
    loadList();
    loadInfo();
  }, []);

  const inProgress = useMemo(
    () =>
      list.filter((r) =>
        ["pending", "resolving", "downloading", "transcribing", "cleaning"].includes(r.status),
      ),
    [list],
  );

  useEffect(() => {
    if (inProgress.length === 0) {
      if (tickRef.current) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    if (tickRef.current) return;
    tickRef.current = window.setInterval(() => {
      setTick((t) => (t + 1) % 1_000_000);
    }, 1000) as unknown as number;
    return () => {
      if (tickRef.current) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [inProgress.length]);

  useEffect(() => {
    if (inProgress.length === 0) {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const updates = await Promise.all(
          inProgress.map((r) =>
            api<JobStatus>(`/api/podcasts/${r.id}/status`)
              .then((j) => ({ row: r, job: j }))
              .catch(() => null),
          ),
        );
        const map: Record<number, JobStatus> = { ...jobs };
        let anyDone = false;
        let anyMetaReady = false;
        for (const u of updates) {
          if (!u) continue;
          const { row: r, job: j } = u;
          map[j.id] = j;
          if (j.status === "done" || j.status === "error") anyDone = true;
          const metaReady =
            j.stage !== "pending" && j.stage !== "resolving" && j.stage !== "error";
          if (metaReady && !metaSeenRef.current.has(j.id)) {
            metaSeenRef.current.add(j.id);
            anyMetaReady = true;
          }
          if (
            (j.status === "done" || j.status === "error") &&
            !notifiedRef.current.has(j.id)
          ) {
            notifiedRef.current.add(j.id);
            const elapsed =
              j.started_at != null
                ? Date.now() / 1000 - j.started_at
                : undefined;
            const title = r.episode_title || r.spotify_episode_id;
            if (j.status === "done") {
              notify({
                title: "Import terminé",
                message: title,
                elapsed,
                variant: "success",
              });
            } else {
              notify({
                title: "Import échoué",
                message: j.error || title,
                elapsed,
                variant: "error",
              });
            }
          }
        }
        setJobs(map);
        if (anyDone || anyMetaReady) loadList();
      } catch {
        // ignore
      }
    }, 2000) as unknown as number;
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [inProgress.length]);

  async function submit() {
    setErr("");
    setMsg("");
    if (!url.trim()) return;
    setSubmitting(true);
    try {
      const r = await api<{ id: number; status: PodcastStatus }>(
        "/api/podcasts/fetch",
        {
          method: "POST",
          body: JSON.stringify({ spotify_url: url.trim() }),
        },
      );
      setMsg(`Ajouté (id ${r.id}). Transcription lancée en arrière-plan.`);
      setUrl("");
      loadList();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function openDetail(id: number) {
    setSelectedId(id);
    setDetail(null);
    try {
      const d = await api<PodcastDetail>(`/api/podcasts/${id}`);
      setDetail(d);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function deleteRow(id: number) {
    if (!confirm("Supprimer ce transcript ?")) return;
    try {
      await api(`/api/podcasts/${id}`, { method: "DELETE" });
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
      }
      loadList();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function runSearch() {
    const q = searchQ.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    try {
      const r = await api<PodcastListRow[]>(
        `/api/podcasts/search?q=${encodeURIComponent(q)}`,
      );
      setSearchResults(r);
    } catch (e) {
      setErr(String(e));
    }
  }

  function copyDetail() {
    if (!detail) return;
    const text = detail.segments.map((s) => s.text).join("\n");
    navigator.clipboard.writeText(text);
    setMsg("Transcript copié dans le presse-papier.");
  }

  const visibleList = searchResults ?? list;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Podcasts</h1>
        <p className="page-header__subtitle">
          Bibliothèque de transcripts. Colle une URL d'épisode Spotify pour lancer
          la transcription locale (faster-whisper sur GPU).
        </p>
      </div>

      {err && (
        <div className="error-banner">
          <span className="error-banner__icon">
            <AlertCircle size={16} />
          </span>
          {err}
          <button
            onClick={() => setErr("")}
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: "none",
              color: "inherit",
              cursor: "pointer",
            }}
            aria-label="Fermer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {msg && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-3)",
            background: "var(--success-bg)",
            border: "1px solid rgba(74, 222, 128, 0.2)",
            borderRadius: "var(--radius-md)",
            padding: "var(--sp-3) var(--sp-4)",
            marginBottom: "var(--sp-5)",
            fontSize: "var(--text-sm)",
            color: "var(--success-400)",
          }}
        >
          <CheckCircle2 size={16} />
          {msg}
          <button
            onClick={() => setMsg("")}
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: "none",
              color: "inherit",
              cursor: "pointer",
            }}
            aria-label="Fermer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* GPU info */}
      {info && (
        <Card variant="outlined" padding="md" style={{ marginBottom: "var(--sp-5)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-3)",
              flexWrap: "wrap",
            }}
          >
            <Cpu
              size={16}
              style={{
                color: info.available ? "var(--amber-400)" : "var(--danger-400)",
              }}
            />
            {info.available ? (
              <span style={{ fontSize: "var(--text-sm)", color: "var(--noir-200)" }}>
                Whisper :{" "}
                <strong>{info.model}</strong>
                {info.compute_type ? ` / ${info.compute_type}` : ""} sur{" "}
                <strong>{info.device_name}</strong>
                {info.vram_gb != null ? ` (${info.vram_gb} Go VRAM)` : ""}
                {" — "}
                <span style={{ color: "var(--amber-300)" }}>
                  {info.backend === "vulkan" ? "Vulkan / whisper.cpp" : "CUDA / faster-whisper"}
                </span>
              </span>
            ) : (
              <span style={{ fontSize: "var(--text-sm)", color: "var(--danger-400)" }}>
                GPU CUDA indisponible — la transcription échouera. {info.error}
              </span>
            )}
          </div>
        </Card>
      )}

      {/* Add form */}
      <Card variant="default" padding="none" style={{ marginBottom: "var(--sp-5)" }}>
        <CardHeader>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
            <Podcast size={18} style={{ color: "var(--amber-400)" }} />
            <span style={{ fontWeight: 600 }}>Ajouter un épisode</span>
          </div>
        </CardHeader>
        <CardBody>
          <div
            style={{
              display: "flex",
              gap: "var(--sp-3)",
              padding: "0 var(--sp-5) var(--sp-5)",
              alignItems: "flex-end",
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: 280 }}>
              <Input
                label="URL Spotify"
                placeholder="https://open.spotify.com/episode/..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
            </div>
            <Button
              variant="primary"
              icon={<Plus size={14} />}
              onClick={submit}
              disabled={submitting || !url.trim()}
            >
              {submitting ? "…" : "Ajouter"}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Search */}
      <Card variant="outlined" padding="md" style={{ marginBottom: "var(--sp-5)" }}>
        <div
          style={{
            display: "flex",
            gap: "var(--sp-3)",
            alignItems: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: 1, minWidth: 240 }}>
            <Input
              label="Recherche"
              icon={<Search size={14} />}
              placeholder="Mot-clé dans le transcript…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
              }}
            />
          </div>
          <Button variant="secondary" onClick={runSearch}>
            Chercher
          </Button>
          {searchResults !== null && (
            <Button
              variant="secondary"
              onClick={() => {
                setSearchResults(null);
                setSearchQ("");
              }}
            >
              Réinitialiser
            </Button>
          )}
        </div>
      </Card>

      {/* List */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: "var(--sp-4)",
          marginBottom: "var(--sp-5)",
        }}
      >
        {visibleList.length === 0 && (
          <Card variant="outlined" padding="md">
            <p style={{ fontSize: "var(--text-sm)", color: "var(--noir-400)" }}>
              {searchResults !== null
                ? "Aucun résultat pour cette recherche."
                : "Aucun podcast dans la bibliothèque. Ajoute une URL Spotify ci-dessus."}
            </p>
          </Card>
        )}
        {visibleList.map((row) => {
          const job = jobs[row.id];
          const stage = job?.stage || row.status;
          const isLoading = ["pending", "resolving", "downloading", "transcribing", "cleaning"].includes(
            stage,
          );
          return (
            <Card
              key={row.id}
              variant={selectedId === row.id ? "amber" : "default"}
              padding="md"
              style={{ cursor: "pointer", position: "relative" }}
              onClick={() => row.status === "done" && openDetail(row.id)}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "var(--sp-2)",
                  marginBottom: "var(--sp-2)",
                }}
              >
                <span
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--noir-400)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {row.show_name || "—"}
                </span>
                <Badge variant={STAGE_VARIANT[stage] || "default"} size="sm">
                  {isLoading && (
                    <Loader2
                      size={10}
                      style={{ marginRight: 4 }}
                      className="alice-spin"
                    />
                  )}
                  {STAGE_LABEL[stage] || stage}
                </Badge>
              </div>
              <h3
                style={{
                  fontSize: "var(--text-md)",
                  fontWeight: 600,
                  marginBottom: "var(--sp-3)",
                  lineHeight: 1.3,
                }}
              >
                {row.episode_title || row.spotify_episode_id}
              </h3>
              <div
                style={{
                  display: "flex",
                  gap: "var(--sp-2)",
                  fontSize: "var(--text-xs)",
                  color: "var(--noir-400)",
                  flexWrap: "wrap",
                }}
              >
                {row.published_at && <span>{row.published_at}</span>}
                <span>· {formatDuration(row.duration_sec)}</span>
                {row.language && <span>· {row.language}</span>}
              </div>
              {isLoading && (
                <div style={{ marginTop: "var(--sp-2)" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: "var(--sp-2)",
                      fontSize: "var(--text-xs)",
                      color: "var(--amber-300)",
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {job?.message || STAGE_LABEL[stage] || stage}
                    </span>
                    <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--noir-300)" }}>
                      {job?.started_at
                        ? formatElapsed(Date.now() / 1000 - job.started_at)
                        : "0:00"}
                      {typeof job?.progress === "number"
                        ? ` · ${Math.round(job.progress * 100)}%`
                        : ""}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: "var(--sp-1)",
                      height: 4,
                      borderRadius: 2,
                      background: "var(--noir-800, rgba(255,255,255,0.06))",
                      overflow: "hidden",
                      position: "relative",
                    }}
                  >
                    {typeof job?.progress === "number" ? (
                      <div
                        style={{
                          width: `${Math.max(0, Math.min(100, job.progress * 100))}%`,
                          height: "100%",
                          background: "var(--amber-400)",
                          transition: "width 0.3s ease",
                        }}
                      />
                    ) : (
                      <div
                        className="alice-indeterminate"
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          height: "100%",
                          width: "30%",
                          background: "var(--amber-400)",
                          opacity: 0.7,
                        }}
                      />
                    )}
                  </div>
                </div>
              )}
              {row.status === "error" && (
                <p
                  style={{
                    marginTop: "var(--sp-2)",
                    fontSize: "var(--text-xs)",
                    color: "var(--danger-400)",
                  }}
                >
                  {row.error || "Échec"}
                </p>
              )}
              <div
                style={{
                  marginTop: "var(--sp-3)",
                  display: "flex",
                  justifyContent: "flex-end",
                }}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 size={12} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteRow(row.id);
                  }}
                >
                  Supprimer
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Detail */}
      {selectedId !== null && (
        <Card variant="default" padding="none">
          <CardHeader>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flex: 1 }}>
              <Podcast size={18} style={{ color: "var(--amber-400)" }} />
              <span style={{ fontWeight: 600 }}>
                {detail?.episode_title || "Détail du transcript"}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              icon={<Copy size={12} />}
              onClick={copyDetail}
              disabled={!detail}
            >
              Copier
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<X size={14} />}
              onClick={() => {
                setSelectedId(null);
                setDetail(null);
              }}
              aria-label="Fermer"
            >
              Fermer
            </Button>
          </CardHeader>
          <CardBody>
            {!detail ? (
              <p style={{ padding: "var(--sp-5)", fontSize: "var(--text-sm)", color: "var(--noir-400)" }}>
                Chargement…
              </p>
            ) : (
              <div style={{ padding: "0 var(--sp-5) var(--sp-5)" }}>
                <div
                  style={{
                    display: "flex",
                    gap: "var(--sp-2)",
                    flexWrap: "wrap",
                    marginBottom: "var(--sp-4)",
                  }}
                >
                  <Badge size="sm">{detail.show_name || "—"}</Badge>
                  {detail.language && <Badge size="sm">{detail.language}</Badge>}
                  <Badge size="sm">{formatDuration(detail.duration_sec)}</Badge>
                  {detail.model_used && (
                    <Badge size="sm" variant="info">
                      {detail.model_used}
                    </Badge>
                  )}
                </div>
                <div
                  style={{
                    maxHeight: 480,
                    overflowY: "auto",
                    border: "1px solid var(--noir-700)",
                    borderRadius: "var(--radius-md)",
                    padding: "var(--sp-3)",
                    fontSize: "var(--text-sm)",
                    lineHeight: "var(--leading-relaxed)",
                  }}
                >
                  {detail.segments.map((s, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        gap: "var(--sp-3)",
                        marginBottom: "var(--sp-2)",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          color: "var(--amber-400)",
                          fontSize: "var(--text-xs)",
                          minWidth: 64,
                          paddingTop: 2,
                        }}
                      >
                        {formatTimestamp(s.start)}
                      </span>
                      <span style={{ color: "var(--noir-100)" }}>{s.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
