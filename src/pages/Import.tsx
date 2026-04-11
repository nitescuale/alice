import { useCallback, useEffect, useState } from "react";
import {
  Upload,
  Copy,
  Check,
  AlertCircle,
  CheckCircle2,
  FileText,
  BookOpen,
  Loader2,
} from "lucide-react";
import { apiBase } from "../api";
import { Card, CardHeader, CardBody } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Badge } from "../components/Badge";

interface UploadResult {
  subject_id: string;
  course_id: string;
  chapter_id: string;
  path: string;
  filename: string;
  index?: { indexed_files?: number; chunks?: number };
  index_error?: string;
}

export function Import() {
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);

  const [subjectTitle, setSubjectTitle] = useState("");
  const [courseTitle, setCourseTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`${apiBase}/api/notebooklm-prompt`)
      .then((r) => r.json())
      .then((d: { prompt: string }) => setPrompt(d.prompt))
      .catch(() => {});
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
    if (!file || !subjectTitle.trim() || !courseTitle.trim()) return;
    setErr("");
    setResult(null);
    setLoading(true);

    const form = new FormData();
    form.append("file", file);
    form.append("subject_title", subjectTitle.trim());
    form.append("course_title", courseTitle.trim());
    form.append("chapter_title", courseTitle.trim());
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
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  const canUpload = file && subjectTitle.trim() && courseTitle.trim();

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Importer un cours</h1>
        <p className="page-header__subtitle">
          Utilisez NotebookLM pour generer un cours structure a partir de vos
          slides, puis importez le fichier Markdown ici.
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

      <div className="settings-grid">
        {/* Step 1: NotebookLM prompt */}
        <Card variant="default" padding="none">
          <CardHeader>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
              <BookOpen size={18} style={{ color: "var(--amber-400)" }} />
              <span style={{ fontWeight: 600, fontSize: "var(--text-md)" }}>
                Etape 1 — Prompt NotebookLM
              </span>
            </div>
            <Button
              variant={copied ? "ghost" : "secondary"}
              size="sm"
              icon={copied ? <Check size={14} /> : <Copy size={14} />}
              onClick={copyPrompt}
              disabled={!prompt}
            >
              {copied ? "Copie !" : "Copier"}
            </Button>
          </CardHeader>
          <CardBody>
            <div style={{ padding: "0 var(--sp-5) var(--sp-5)" }}>
              <p style={{ fontSize: "var(--text-sm)", color: "var(--noir-300)", marginBottom: "var(--sp-3)" }}>
                Copiez ce prompt et collez-le dans NotebookLM comme instruction
                systeme, avec vos slides en source. NotebookLM generera un cours
                Markdown structure.
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
                Etape 2 — Importer le fichier
              </span>
            </div>
          </CardHeader>
          <CardBody>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)", padding: "0 var(--sp-5) var(--sp-5)" }}>
              <Input
                label="Matiere"
                value={subjectTitle}
                onChange={(e) => setSubjectTitle(e.target.value)}
                placeholder="ex: Data Science"
                hint="Nom de la matiere (existante ou nouvelle)"
              />
              <Input
                label="Cours"
                value={courseTitle}
                onChange={(e) => setCourseTitle(e.target.value)}
                placeholder="ex: Fondamentaux des Reseaux Complexes"
                hint="Nom du cours a creer ou completer"
              />

              {/* Drop zone */}
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

      {/* Result */}
      {result && (
        <div style={{ marginTop: "var(--sp-6)" }}>
          <Card variant="default" padding="md" className="animate-fade-in">
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", marginBottom: "var(--sp-4)" }}>
              <CheckCircle2 size={20} style={{ color: "var(--success-500)" }} />
              <span style={{ fontWeight: 600, fontSize: "var(--text-md)" }}>
                Chapitre importe
              </span>
            </div>
            <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap", marginBottom: "var(--sp-3)" }}>
              <Badge variant="amber" size="sm">{result.subject_id}</Badge>
              <Badge variant="info" size="sm">{result.course_id}</Badge>
              <Badge variant="default" size="sm">{result.chapter_id}</Badge>
            </div>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--noir-400)", margin: "0 0 var(--sp-2)" }}>
              Fichier : <code>{result.filename}</code> dans <code>subjects/{result.path}/</code>
            </p>
            {result.index && (
              <p style={{ fontSize: "var(--text-xs)", color: "var(--noir-400)", margin: 0 }}>
                RAG : {result.index.indexed_files ?? "?"} fichiers indexes, {result.index.chunks ?? "?"} chunks
              </p>
            )}
            {result.index_error && (
              <p style={{ fontSize: "var(--text-xs)", color: "var(--danger-500)", margin: 0 }}>
                Erreur index : {result.index_error}
              </p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
