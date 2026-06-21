import { Input } from "alice";

const wrap: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--sp-4)",
  maxWidth: 360,
};

const SearchIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export function Default() {
  return (
    <div style={wrap}>
      <Input label="Nom du podcast" placeholder="Lex Fridman #420" defaultValue="Huberman Lab" />
    </div>
  );
}

export function WithHint() {
  return (
    <div style={wrap}>
      <Input
        label="URL YouTube"
        placeholder="https://youtube.com/watch?v=…"
        hint="Colle un lien ou dépose un fichier audio."
      />
    </div>
  );
}

export function WithIcon() {
  return (
    <div style={wrap}>
      <Input label="Rechercher" placeholder="Filtrer les questions…" icon={SearchIcon} />
    </div>
  );
}

export function WithError() {
  return (
    <div style={wrap}>
      <Input
        label="Clé API"
        defaultValue="sk-invalide"
        error="Clé refusée par le serveur."
      />
    </div>
  );
}
