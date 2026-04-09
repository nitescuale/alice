import { useState } from "react";
import Markdown from "react-markdown";
import { api } from "../api";

export function Interviews() {
  const [problem, setProblem] = useState("");
  const [company, setCompany] = useState("sample-co");
  const [mode, setMode] = useState<"hint" | "approach">("hint");
  const [reply, setReply] = useState("");
  const [candidate, setCandidate] = useState("");
  const [evaluation, setEvaluation] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function interact() {
    setErr("");
    setLoading(true);
    setReply("");
    try {
      const r = await api<{ reply: string }>("/api/interview/interact", {
        method: "POST",
        body: JSON.stringify({
          problem,
          company: company || null,
          mode: mode === "hint" ? "hint" : "approach",
        }),
      });
      setReply(r.reply);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function evaluate() {
    setErr("");
    setLoading(true);
    setEvaluation("");
    try {
      const r = await api<{ evaluation: string }>("/api/interview/evaluate", {
        method: "POST",
        body: JSON.stringify({
          problem,
          candidate_answer: candidate,
          company: company || null,
        }),
      });
      setEvaluation(r.evaluation);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1>Entraînement interviews</h1>
      <p className="muted">
        Banque locale sous <code>subjects/interviews/</code> (ex. sample-co). RAG + Ollama pour indices et évaluation.
      </p>
      {err && <p className="error">{err}</p>}

      <label>
        Entreprise / dossier (optionnel)
        <input
          style={{ display: "block", width: "100%", maxWidth: 320, marginTop: 4 }}
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="sample-co"
        />
      </label>

      <h2>Énoncé</h2>
      <textarea value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="Colle l’énoncé (ou décris le problème)…" />

      <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
        <label>
          <input type="radio" checked={mode === "hint"} onChange={() => setMode("hint")} /> Indice
        </label>
        <label>
          <input type="radio" checked={mode === "approach"} onChange={() => setMode("approach")} /> Approche / solution
        </label>
        <button type="button" disabled={loading || !problem.trim()} onClick={interact}>
          Lancer
        </button>
      </div>

      {reply && (
        <div className="md" style={{ marginTop: "1rem" }}>
          <Markdown>{reply}</Markdown>
        </div>
      )}

      <h2 style={{ marginTop: "2rem" }}>Évaluation de ta réponse</h2>
      <textarea
        value={candidate}
        onChange={(e) => setCandidate(e.target.value)}
        placeholder="Ta réponse (code ou plan)…"
      />
      <p>
        <button type="button" className="secondary" disabled={loading || !problem.trim() || !candidate.trim()} onClick={evaluate}>
          Évaluer (brutal mais constructif)
        </button>
      </p>
      {evaluation && (
        <div className="md" style={{ marginTop: "1rem" }}>
          <Markdown>{evaluation}</Markdown>
        </div>
      )}
    </div>
  );
}
