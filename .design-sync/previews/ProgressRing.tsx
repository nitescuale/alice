import { ProgressRing } from "alice";

const row: React.CSSProperties = {
  display: "flex",
  gap: "var(--sp-5)",
  alignItems: "center",
  flexWrap: "wrap",
};

// The fill color is derived from `value`: <50 danger, 50–79 amber, ≥80 success.
export function Scores() {
  return (
    <div style={row}>
      <ProgressRing value={35} label="35" />
      <ProgressRing value={65} label="65" />
      <ProgressRing value={88} label="88" />
    </div>
  );
}

export function Sizes() {
  return (
    <div style={row}>
      <ProgressRing value={72} size={64} strokeWidth={6} label="72" />
      <ProgressRing value={72} size={100} strokeWidth={8} label="72" />
      <ProgressRing value={72} size={140} strokeWidth={10} label="72" />
    </div>
  );
}
