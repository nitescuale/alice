import { Select } from "alice";

const wrap: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--sp-4)",
  maxWidth: 360,
};

const topics = [
  { value: "deep-learning", label: "Deep Learning" },
  { value: "llms", label: "LLMs" },
  { value: "computer-vision", label: "Computer Vision" },
  { value: "feature-engineering", label: "Feature Engineering" },
];

export function Default() {
  return (
    <div style={wrap}>
      <Select label="Sujet" options={topics} defaultValue="llms" />
    </div>
  );
}

export function WithPlaceholder() {
  return (
    <div style={wrap}>
      <Select label="Sujet" placeholder="Choisir un sujet…" options={topics} />
    </div>
  );
}
