import { Tabs } from "alice";

const tabs = [
  { id: "transcript", label: "Transcription" },
  { id: "summary", label: "Résumé" },
  { id: "questions", label: "Questions" },
];

const panel: React.CSSProperties = {
  padding: "var(--sp-3) 0",
  color: "var(--noir-300)",
  fontSize: "var(--text-sm)",
};

const bodies: Record<string, string> = {
  transcript: "Transcription nettoyée du podcast, segmentée par chapitre.",
  summary: "Résumé généré : points clés et plan en trois minutes.",
  questions: "12 questions d'entraînement extraites de l'épisode.",
};

export function Default() {
  return (
    <Tabs tabs={tabs} defaultTab="transcript">
      {(active) => <div style={panel}>{bodies[active]}</div>}
    </Tabs>
  );
}

export function SecondTabActive() {
  return (
    <Tabs tabs={tabs} defaultTab="summary">
      {(active) => <div style={panel}>{bodies[active]}</div>}
    </Tabs>
  );
}
