import { useState } from "react";
import {
  GitBranch,
  Download,
  AlertCircle,
  CheckCircle2,
  FileText,
  RefreshCw,
  Key,
  Hash,
} from "lucide-react";
import { api } from "../api";
import { Card, CardHeader, CardBody } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Badge } from "../components/Badge";

interface ImportResult {
  owner: string;
  repo: string;
  ref: string;
  dest_dir: string;
  files_written: number;
  skipped: number;
  paths: string[];
  index?: Record<string, unknown>;
  index_error?: string;
}

export function GitHubImport() {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [maxFiles, setMaxFiles] = useState("200");
  const [reindex, setReindex] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [err, setErr] = useState("");

  async function runImport() {
    if (!url.trim()) return;
    setErr("");
    setResult(null);
    setLoading(true);
    try {
      const r = await api<ImportResult>("/api/github/import", {
        method: "POST",
        body: JSON.stringify({
          url: url.trim(),
          token: token.trim() || null,
          max_files: parseInt(maxFiles, 10) || 200,
          reindex,
        }),
      });
      setResult(r);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Import GitHub</h1>
        <p className="page-header__subtitle">
          Importez un depot GitHub public dans la base de connaissances ALICE.
          Les fichiers texte (.md, .txt, .py, .ipynb) sont telecharges et
          indexes automatiquement.
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
        {/* Import form */}
        <Card variant="default" padding="none">
          <CardHeader>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-3)",
              }}
            >
              <GitBranch size={18} style={{ color: "var(--amber-400)" }} />
              <span style={{ fontWeight: 600, fontSize: "var(--text-md)" }}>
                Depot GitHub
              </span>
            </div>
            <Badge variant="info" size="sm">
              Public
            </Badge>
          </CardHeader>
          <CardBody>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--sp-5)",
                padding: "0 var(--sp-5) var(--sp-5)",
              }}
            >
              <Input
                label="URL du depot"
                icon={<GitBranch size={14} />}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                hint="Supporte aussi les URL de branche : .../tree/main"
              />

              <Input
                label="Token GitHub (optionnel)"
                icon={<Key size={14} />}
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_..."
                hint="Laisser vide pour les depots publics"
              />

              <Input
                label="Nombre max de fichiers"
                icon={<Hash size={14} />}
                type="number"
                value={maxFiles}
                onChange={(e) => setMaxFiles(e.target.value)}
                hint="Limite le nombre de fichiers telecharges (defaut : 200)"
              />

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-3)",
                }}
              >
                <input
                  type="checkbox"
                  id="reindex-check"
                  checked={reindex}
                  onChange={(e) => setReindex(e.target.checked)}
                  style={{ accentColor: "var(--amber-400)", width: 16, height: 16 }}
                />
                <label
                  htmlFor="reindex-check"
                  style={{
                    fontSize: "var(--text-sm)",
                    color: "var(--noir-200)",
                    cursor: "pointer",
                  }}
                >
                  Reindexer le RAG apres l'import
                </label>
              </div>

              <div className="settings-actions">
                <Button
                  variant="primary"
                  icon={loading ? <RefreshCw size={14} /> : <Download size={14} />}
                  loading={loading}
                  disabled={loading || !url.trim()}
                  onClick={runImport}
                >
                  {loading ? "Import en cours..." : "Importer"}
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Info panel */}
        <Card variant="outlined" padding="md">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-3)",
              marginBottom: "var(--sp-3)",
            }}
          >
            <FileText size={18} style={{ color: "var(--amber-400)" }} />
            <span style={{ fontWeight: 600, fontSize: "var(--text-md)" }}>
              Comment ca marche
            </span>
          </div>
          <ol
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--noir-300)",
              lineHeight: "var(--leading-relaxed)",
              paddingLeft: "var(--sp-5)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--sp-3)",
              margin: 0,
            }}
          >
            <li>
              Un seul appel API GitHub (Git Trees) recupere la liste complete
              des fichiers sans consommer de quota par fichier.
            </li>
            <li>
              Les fichiers sont telecharges via{" "}
              <code>raw.githubusercontent.com</code> — pas de limite de debit
              pour les depots publics.
            </li>
            <li>
              Les fichiers sont ecrits sous{" "}
              <code>subjects/github/owner__repo/</code>.
            </li>
            <li>
              Si "Reindexer" est coche, le RAG est reconstruit automatiquement
              pour inclure le nouveau contenu.
            </li>
          </ol>
          <div
            style={{
              marginTop: "var(--sp-4)",
              padding: "var(--sp-3)",
              background: "rgba(212, 160, 74, 0.08)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid rgba(212, 160, 74, 0.2)",
            }}
          >
            <p
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--amber-400)",
                margin: 0,
              }}
            >
              Extensions supportees : .md · .txt · .py · .ipynb · .pdf
            </p>
          </div>
        </Card>
      </div>

      {/* Result */}
      {result && (
        <div style={{ marginTop: "var(--sp-6)" }}>
          <Card variant="default" padding="md" className="animate-fade-in">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-3)",
                marginBottom: "var(--sp-4)",
              }}
            >
              <CheckCircle2
                size={20}
                style={{ color: "var(--success-500)" }}
              />
              <span style={{ fontWeight: 600, fontSize: "var(--text-md)" }}>
                Import termine
              </span>
            </div>

            <div
              style={{
                display: "flex",
                gap: "var(--sp-3)",
                flexWrap: "wrap",
                marginBottom: "var(--sp-4)",
              }}
            >
              <Badge variant="amber" size="sm">
                {result.owner}/{result.repo}
              </Badge>
              <Badge variant="info" size="sm">
                ref : {result.ref}
              </Badge>
              <Badge variant="success" size="sm">
                {result.files_written} fichiers
              </Badge>
              {result.skipped > 0 && (
                <Badge variant="default" size="sm">
                  {result.skipped} ignores
                </Badge>
              )}
            </div>

            <p
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--noir-400)",
                marginBottom: "var(--sp-3)",
              }}
            >
              Destination : <code>{result.dest_dir}</code>
            </p>

            {result.index && (
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--noir-400)",
                  marginBottom: "var(--sp-3)",
                }}
              >
                RAG :{" "}
                {(result.index as { indexed_files?: number }).indexed_files ??
                  "?"}{" "}
                fichiers indexes,{" "}
                {(result.index as { chunks?: number }).chunks ?? "?"} chunks
              </p>
            )}

            {result.index_error && (
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--danger-500)",
                  marginBottom: "var(--sp-3)",
                }}
              >
                Erreur index : {result.index_error}
              </p>
            )}

            {result.paths.length > 0 && (
              <details style={{ marginTop: "var(--sp-2)" }}>
                <summary
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--noir-400)",
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  Voir les fichiers ({result.paths.length})
                </summary>
                <div
                  style={{
                    marginTop: "var(--sp-2)",
                    maxHeight: 280,
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--sp-1)",
                  }}
                >
                  {result.paths.map((p) => (
                    <div
                      key={p}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--sp-2)",
                        padding: "var(--sp-1) var(--sp-2)",
                        borderRadius: "var(--radius-sm)",
                        background: "var(--noir-800)",
                      }}
                    >
                      <FileText
                        size={11}
                        style={{ color: "var(--amber-400)", flexShrink: 0 }}
                      />
                      <code
                        style={{
                          fontSize: "0.68rem",
                          color: "var(--noir-300)",
                          wordBreak: "break-all",
                        }}
                      >
                        {p}
                      </code>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
