import { Badge } from "alice";

const row: React.CSSProperties = {
  display: "flex",
  gap: "var(--sp-2)",
  alignItems: "center",
  flexWrap: "wrap",
};

export function Variants() {
  return (
    <div style={row}>
      <Badge variant="default">Brouillon</Badge>
      <Badge variant="amber">En cours</Badge>
      <Badge variant="success">Terminé</Badge>
      <Badge variant="danger">Échec</Badge>
      <Badge variant="info">Transcription</Badge>
    </div>
  );
}

export function Sizes() {
  return (
    <div style={row}>
      <Badge variant="amber" size="sm">
        sm · 12 questions
      </Badge>
      <Badge variant="amber" size="md">
        md · Deep Learning
      </Badge>
    </div>
  );
}
