import { Button } from "alice";

const row: React.CSSProperties = {
  display: "flex",
  gap: "var(--sp-3)",
  alignItems: "center",
  flexWrap: "wrap",
};

const DownloadIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export function Variants() {
  return (
    <div style={row}>
      <Button variant="primary">Importer</Button>
      <Button variant="secondary">Indice</Button>
      <Button variant="ghost">Voir la référence</Button>
      <Button variant="danger">Supprimer</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div style={row}>
      <Button variant="primary" size="sm">
        Petit
      </Button>
      <Button variant="primary" size="md">
        Moyen
      </Button>
      <Button variant="primary" size="lg">
        Grand
      </Button>
    </div>
  );
}

export function WithIcon() {
  return (
    <div style={row}>
      <Button variant="primary" icon={DownloadIcon}>
        Importer la banque
      </Button>
      <Button variant="secondary" icon={DownloadIcon}>
        Ré-importer
      </Button>
    </div>
  );
}

export function States() {
  return (
    <div style={row}>
      <Button variant="primary" loading>
        Traduction…
      </Button>
      <Button variant="primary" disabled>
        Indisponible
      </Button>
    </div>
  );
}
