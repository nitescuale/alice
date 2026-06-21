import { Card, CardHeader, CardBody } from "alice";

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(220px, 1fr))",
  gap: "var(--sp-3)",
};

const title: React.CSSProperties = {
  fontWeight: 600,
  color: "var(--noir-100)",
};

const body: React.CSSProperties = {
  color: "var(--noir-300)",
  fontSize: "var(--text-sm)",
};

export function Variants() {
  return (
    <div style={grid}>
      <Card variant="default">
        <CardHeader>
          <span style={title}>Par défaut</span>
        </CardHeader>
        <CardBody>
          <span style={body}>Surface neutre pour le contenu courant.</span>
        </CardBody>
      </Card>
      <Card variant="outlined">
        <CardHeader>
          <span style={title}>Contour</span>
        </CardHeader>
        <CardBody>
          <span style={body}>Bordure marquée, fond transparent.</span>
        </CardBody>
      </Card>
      <Card variant="elevated">
        <CardHeader>
          <span style={title}>Surélevée</span>
        </CardHeader>
        <CardBody>
          <span style={body}>Ombre portée pour la mise en avant.</span>
        </CardBody>
      </Card>
      <Card variant="amber">
        <CardHeader>
          <span style={title}>Ambre</span>
        </CardHeader>
        <CardBody>
          <span style={body}>Accent de marque pour les appels à l'action.</span>
        </CardBody>
      </Card>
    </div>
  );
}

export function Paddings() {
  return (
    <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
      <Card variant="outlined" padding="sm">
        <span style={body}>padding sm</span>
      </Card>
      <Card variant="outlined" padding="md">
        <span style={body}>padding md</span>
      </Card>
      <Card variant="outlined" padding="lg">
        <span style={body}>padding lg</span>
      </Card>
    </div>
  );
}
