import { useEffect, useState } from "react";
import { api } from "../api";

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
      setMsg("Réglages enregistrés (session backend).");
    } catch (e) {
      setErr(String(e));
    }
  }

  async function refreshModels() {
    setErr("");
    try {
      const r = await api<{ models: string[]; error?: string }>("/api/ollama/models");
      if (r.error) setErr(r.error);
      setModels(r.models ?? []);
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <div>
      <h1>Réglages</h1>
      <p className="muted">Ollama uniquement (pas d’API cloud). URL et modèle utilisés par le backend Python.</p>
      {err && <p className="error">{err}</p>}
      {msg && <p className="muted">{msg}</p>}

      <label style={{ display: "block", marginTop: "1rem" }}>
        Ollama host
        <input
          style={{ display: "block", width: "100%", maxWidth: 400, marginTop: 4 }}
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
      </label>

      <label style={{ display: "block", marginTop: "1rem" }}>
        Modèle
        <input
          style={{ display: "block", width: "100%", maxWidth: 400, marginTop: 4 }}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          list="model-list"
        />
      </label>
      <datalist id="model-list">
        {models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>

      <p style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button type="button" onClick={save}>Enregistrer</button>
        <button type="button" className="secondary" onClick={refreshModels}>
          Rafraîchir les modèles Ollama
        </button>
      </p>

      <h2 style={{ marginTop: "2rem" }}>Contenu</h2>
      <p className="muted">
        Cours : dossier <code>subjects/</code> + <code>taxonomy.yaml</code>. Auteur recommandé : NotebookLM → export manuel vers ces dossiers.
      </p>
    </div>
  );
}
