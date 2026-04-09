import { useEffect, useState } from "react";
import {
  Settings as SettingsIcon,
  Save,
  RefreshCw,
  Server,
  Cpu,
  AlertCircle,
  CheckCircle2,
  FolderOpen,
} from "lucide-react";
import { api } from "../api";
import { Card, CardHeader, CardBody } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Badge } from "../components/Badge";

export function Settings() {
  const [host, setHost] = useState("http://127.0.0.1:11434");
  const [model, setModel] = useState("gemma2:2b");
  const [models, setModels] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    api<{ ollama_host: string; ollama_model: string }>("/api/settings")
      .then((s) => {
        setHost(s.ollama_host);
        setModel(s.ollama_model);
      })
      .catch(() => {});
  }, []);

  async function save() {
    setErr("");
    setMsg("");
    try {
      await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({ ollama_host: host, ollama_model: model }),
      });
      setMsg("Reglages enregistres (session backend).");
    } catch (e) {
      setErr(String(e));
    }
  }

  async function refreshModels() {
    setErr("");
    try {
      const r = await api<{ models: string[]; error?: string }>(
        "/api/ollama/models"
      );
      if (r.error) setErr(r.error);
      setModels(r.models ?? []);
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Reglages</h1>
        <p className="page-header__subtitle">
          Configuration Ollama et gestion du contenu. L'application utilise
          uniquement des modeles locaux.
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
            animation: "fadeIn var(--duration-fast) var(--ease-out)",
          }}
        >
          <CheckCircle2 size={16} />
          {msg}
        </div>
      )}

      <div className="settings-grid">
        {/* Ollama configuration */}
        <Card variant="default" padding="none">
          <CardHeader>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
              <SettingsIcon size={18} style={{ color: "var(--amber-400)" }} />
              <span style={{ fontWeight: 600, fontSize: "var(--text-md)" }}>
                Ollama
              </span>
            </div>
            <Badge variant="info" size="sm">Local</Badge>
          </CardHeader>
          <CardBody>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)", padding: "0 var(--sp-5) var(--sp-5)" }}>
              <Input
                label="Ollama Host"
                icon={<Server size={14} />}
                value={host}
                onChange={(e) => setHost(e.target.value)}
                hint="URL du serveur Ollama local"
              />

              <div>
                <Input
                  label="Modele"
                  icon={<Cpu size={14} />}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  list="model-list"
                  hint="Nom du modele a utiliser"
                />
                <datalist id="model-list">
                  {models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>

              {models.length > 0 && (
                <div
                  className="animate-fade-in"
                  style={{
                    display: "flex",
                    gap: "var(--sp-2)",
                    flexWrap: "wrap",
                  }}
                >
                  {models.map((m) => (
                    <Badge
                      key={m}
                      variant={m === model ? "amber" : "default"}
                      size="sm"
                      style={{ cursor: "pointer" }}
                      onClick={() => setModel(m)}
                    >
                      <Cpu size={10} style={{ marginRight: 4 }} />
                      {m}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="settings-actions">
                <Button
                  variant="primary"
                  icon={<Save size={14} />}
                  onClick={save}
                >
                  Enregistrer
                </Button>
                <Button
                  variant="secondary"
                  icon={<RefreshCw size={14} />}
                  onClick={refreshModels}
                >
                  Rafraichir les modeles
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Content info */}
        <Card variant="outlined" padding="md">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", marginBottom: "var(--sp-3)" }}>
            <FolderOpen size={18} style={{ color: "var(--amber-400)" }} />
            <span style={{ fontWeight: 600, fontSize: "var(--text-md)" }}>
              Contenu
            </span>
          </div>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--noir-300)", lineHeight: "var(--leading-relaxed)" }}>
            Les cours sont organises dans le dossier{" "}
            <code>subjects/</code> avec un fichier{" "}
            <code>taxonomy.yaml</code> a la racine.
          </p>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--noir-400)", marginTop: "var(--sp-2)" }}>
            Auteur recommande : NotebookLM, puis export manuel vers ces dossiers.
          </p>
        </Card>
      </div>
    </div>
  );
}
