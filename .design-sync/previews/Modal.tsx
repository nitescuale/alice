import { Modal, Button } from "alice";

const body: React.CSSProperties = {
  color: "var(--noir-300)",
  fontSize: "var(--text-sm)",
  lineHeight: 1.6,
};

const actions: React.CSSProperties = {
  display: "flex",
  gap: "var(--sp-2)",
  justifyContent: "flex-end",
  marginTop: "var(--sp-4)",
};

// Modal renders nothing when `open` is false, so the preview pins it open.
// onClose is a no-op here — the card captures the open state.
export function Open() {
  return (
    <Modal open title="Supprimer le podcast ?" onClose={() => {}}>
      <p style={body}>
        Cette action retire l'épisode, sa transcription et les questions
        associées. Elle est irréversible.
      </p>
      <div style={actions}>
        <Button variant="ghost">Annuler</Button>
        <Button variant="danger">Supprimer</Button>
      </div>
    </Modal>
  );
}
